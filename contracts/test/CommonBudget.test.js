const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

const id = (s) => ethers.id(s);
const WS = id('workspace-1');
const AGENT_A = id('agent-a');
const AGENT_B = id('agent-b');
const KEY = id('provider:protocol-data:daily:workspace-1');
const OP_A = id('op-a');
const OP_B = id('op-b');
const PARAMS = id('params-v1');
const OTHER_PARAMS = id('params-v2');
const TTL = 300;
const AMOUNT = 30000n;

const ASSET = '0.0.0';
const PAY_TO = '0.0.1234';
const RESOURCE = 'https://example.test/dataset';

async function deploy() {
  const [operator, outsider] = await ethers.getSigners();
  const CommonBudget = await ethers.getContractFactory('CommonBudget');
  const c = await CommonBudget.deploy();
  await c.createWorkspace(WS, operator.address);
  await c.fundWorkspace(WS, 100000n);
  await c.setAgentAuthorization(WS, AGENT_A, true);
  await c.setAgentAuthorization(WS, AGENT_B, true);
  return { c, operator, outsider };
}

const reserve = (c, opId, agent, amount = AMOUNT, params = PARAMS) =>
  c.reserve(opId, WS, agent, KEY, amount, ASSET, PAY_TO, RESOURCE, TTL, params);

describe('CommonBudget', () => {
  describe('atomic reservation — the core claim of the project', () => {
    it('lets exactly one of two competing agents claim the same purchase key', async () => {
      const { c } = await deploy();
      await reserve(c, OP_A, AGENT_A);
      await expect(reserve(c, OP_B, AGENT_B))
        .to.be.revertedWithCustomError(c, 'PurchaseAlreadyReserved')
        .withArgs(OP_A);
      expect(await c.activeClaim(WS, KEY)).to.equal(OP_A);
    });

    it('commits budget on reserve so a concurrent reservation sees it as unavailable', async () => {
      const { c } = await deploy();
      await reserve(c, OP_A, AGENT_A);
      expect(await c.availableBudget(WS)).to.equal(100000n - AMOUNT);
    });

    it('rejects a reservation exceeding uncommitted budget', async () => {
      const { c } = await deploy();
      await expect(reserve(c, OP_A, AGENT_A, 100001n)).to.be.revertedWithCustomError(c, 'InsufficientBudget');
    });

    it('rejects an unauthorized agent', async () => {
      const { c } = await deploy();
      await c.setAgentAuthorization(WS, AGENT_A, false);
      await expect(reserve(c, OP_A, AGENT_A)).to.be.revertedWithCustomError(c, 'AgentNotAuthorized');
    });

    it('rejects a caller that is not the workspace operator', async () => {
      const { c, outsider } = await deploy();
      await expect(reserve(c.connect(outsider), OP_A, AGENT_A)).to.be.revertedWithCustomError(c, 'NotOperator');
    });
  });

  describe('retry safety — stable operation IDs across restarts', () => {
    it('treats a repeat of the same operation ID with identical parameters as a no-op', async () => {
      const { c } = await deploy();
      await reserve(c, OP_A, AGENT_A);
      await reserve(c, OP_A, AGENT_A); // crash-and-retry
      expect(await c.availableBudget(WS)).to.equal(100000n - AMOUNT); // committed once, not twice
    });

    it('rejects the same operation ID with conflicting parameters', async () => {
      const { c } = await deploy();
      await reserve(c, OP_A, AGENT_A);
      await expect(reserve(c, OP_A, AGENT_A, AMOUNT, OTHER_PARAMS))
        .to.be.revertedWithCustomError(c, 'ConflictingParameters');
    });

    it('rejects the same operation ID with a conflicting amount', async () => {
      const { c } = await deploy();
      await reserve(c, OP_A, AGENT_A);
      await expect(reserve(c, OP_A, AGENT_A, AMOUNT + 1n)).to.be.revertedWithCustomError(c, 'ConflictingParameters');
    });
  });

  describe('unknown settlement must never become a second payment', () => {
    it('refuses to release while settlement is unknown', async () => {
      const { c } = await deploy();
      await reserve(c, OP_A, AGENT_A);
      await c.markPaymentPending(OP_A);
      await c.flagSettlementUnknown(OP_A);
      await expect(c.release(OP_A)).to.be.revertedWithCustomError(c, 'SettlementUnknownBlocksRelease');
    });

    it('keeps the purchase key claimed while settlement is unknown', async () => {
      const { c } = await deploy();
      await reserve(c, OP_A, AGENT_A);
      await c.markPaymentPending(OP_A);
      await c.flagSettlementUnknown(OP_A);
      await expect(reserve(c, OP_B, AGENT_B)).to.be.revertedWithCustomError(c, 'PurchaseAlreadyReserved');
    });

    it('does not expire an unknown settlement even after the deadline passes', async () => {
      const { c } = await deploy();
      await reserve(c, OP_A, AGENT_A);
      await c.markPaymentPending(OP_A);
      await c.flagSettlementUnknown(OP_A);
      await time.increase(TTL + 60);
      await expect(c.expire(OP_A)).to.be.revertedWithCustomError(c, 'InvalidState');
    });

    it('resolves to paid when reconciliation finds the transfer', async () => {
      const { c } = await deploy();
      await reserve(c, OP_A, AGENT_A);
      await c.markPaymentPending(OP_A);
      await c.flagSettlementUnknown(OP_A);
      await expect(c.recordSettlement(OP_A, '0.0.5@1.2', AMOUNT)).to.emit(c, 'PaymentSettled');
      const w = await c.getWorkspace(WS);
      expect(w.spent).to.equal(AMOUNT);
      expect(w.committed).to.equal(0n);
    });

    it('returns budget only after reconciliation proves the transfer absent', async () => {
      const { c } = await deploy();
      await reserve(c, OP_A, AGENT_A);
      await c.markPaymentPending(OP_A);
      await c.flagSettlementUnknown(OP_A);
      await c.releaseAfterReconciliation(OP_A);
      expect(await c.availableBudget(WS)).to.equal(100000n);
    });
  });

  describe('expiry of unpaid reservations', () => {
    it('refuses to expire before the deadline', async () => {
      const { c } = await deploy();
      await reserve(c, OP_A, AGENT_A);
      await expect(c.expire(OP_A)).to.be.revertedWithCustomError(c, 'ReservationNotExpired');
    });

    it('frees budget and the purchase key after expiry', async () => {
      const { c } = await deploy();
      await reserve(c, OP_A, AGENT_A);
      await time.increase(TTL + 1);
      await c.expire(OP_A);
      expect(await c.availableBudget(WS)).to.equal(100000n);
      await reserve(c, OP_B, AGENT_B);
      expect(await c.activeClaim(WS, KEY)).to.equal(OP_B);
    });

    it('refuses to expire an already settled payment', async () => {
      const { c } = await deploy();
      await reserve(c, OP_A, AGENT_A);
      await c.markPaymentPending(OP_A);
      await c.recordSettlement(OP_A, '0.0.5@1.2', AMOUNT);
      await time.increase(TTL + 60);
      await expect(c.expire(OP_A)).to.be.revertedWithCustomError(c, 'InvalidState');
    });
  });

  describe('payment and delivery are separate outcomes', () => {
    it('records a delivery failure without refunding or freeing the claim', async () => {
      const { c } = await deploy();
      await reserve(c, OP_A, AGENT_A);
      await c.markPaymentPending(OP_A);
      await c.recordSettlement(OP_A, '0.0.5@1.2', AMOUNT);
      await c.recordDelivery(OP_A, false, 0, '', 'provider returned corrupt payload');

      const w = await c.getWorkspace(WS);
      expect(w.spent).to.equal(AMOUNT); // payment stands
      await expect(reserve(c, OP_B, AGENT_B)).to.be.revertedWithCustomError(c, 'PurchaseAlreadyReserved');
    });

    it('rejects a settlement amount that disagrees with the reservation', async () => {
      const { c } = await deploy();
      await reserve(c, OP_A, AGENT_A);
      await c.markPaymentPending(OP_A);
      await expect(c.recordSettlement(OP_A, '0.0.5@1.2', AMOUNT + 1n))
        .to.be.revertedWithCustomError(c, 'ConflictingParameters');
    });

    it('records a successful delivery', async () => {
      const { c } = await deploy();
      await reserve(c, OP_A, AGENT_A);
      await c.markPaymentPending(OP_A);
      await c.recordSettlement(OP_A, '0.0.5@1.2', AMOUNT);
      await expect(c.recordDelivery(OP_A, true, 9999999999, 'result-1', ''))
        .to.emit(c, 'DeliveryRecorded').withArgs(OP_A, true, 9999999999, 'result-1', '');
    });
  });

  describe('decisions', () => {
    it('records a reuse decision without moving budget', async () => {
      const { c } = await deploy();
      await expect(c.recordDecision(WS, id('decision-1'), AGENT_B, 1, ethers.ZeroHash, '12345'))
        .to.emit(c, 'DecisionRecorded');
      expect(await c.availableBudget(WS)).to.equal(100000n);
    });
  });
});
