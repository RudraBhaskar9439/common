/**
 * Typed client for the deployed CommonBudget contract, over Hedera's EVM JSON-RPC relay.
 *
 * Identifier handling: the contract stores bytes32 hashes, not strings, so string ids
 * are hashed on the way in. Hashes are one-way, so a local registry remembers the
 * originals for reads. That registry is a convenience cache — the CONTRACT is the source
 * of authority for status and amounts, never the cache.
 */
import { Contract, JsonRpcProvider, Wallet, AbiCoder, keccak256, id as keccakString } from 'ethers';
import { CommonError } from '@common/interfaces';

/** Mirrors CommonBudget.Status. */
export enum ContractStatus {
  None = 0,
  Reserved = 1,
  PaymentPending = 2,
  SettlementUnknown = 3,
  Paid = 4,
  Delivered = 5,
  DeliveryFailed = 6,
  Released = 7,
  Expired = 8,
}

export const ABI = [
  'function reserve(bytes32 operationId, bytes32 workspaceId, bytes32 agentId, bytes32 purchaseKey, uint256 amount, string asset, string payTo, string resource, uint64 ttlSeconds, bytes32 paramsHash)',
  'function markPaymentPending(bytes32 operationId)',
  'function flagSettlementUnknown(bytes32 operationId)',
  'function recordSettlement(bytes32 operationId, string transactionId, uint256 amount)',
  'function recordDelivery(bytes32 operationId, bool usable, uint64 freshUntil, string resultRef, string failureReason)',
  'function release(bytes32 operationId)',
  'function releaseAfterReconciliation(bytes32 operationId)',
  'function expire(bytes32 operationId)',
  'function recordDecision(bytes32 workspaceId, bytes32 decisionId, bytes32 agentId, uint8 decisionType, bytes32 operationId, string hcsSequenceNumber)',
  'function getOperation(bytes32 operationId) view returns (tuple(bytes32 workspaceId, bytes32 purchaseKey, bytes32 agentId, uint256 amount, uint64 expiresAt, uint64 policyVersion, uint8 status, bytes32 paramsHash))',
  'function availableBudget(bytes32 workspaceId) view returns (uint256)',
  'function activeClaim(bytes32 workspaceId, bytes32 purchaseKey) view returns (bytes32)',
  'function isAgentAuthorized(bytes32 workspaceId, bytes32 agentId) view returns (bool)',
  'function createWorkspace(bytes32 workspaceId, address operator)',
  'function fundWorkspace(bytes32 workspaceId, uint256 amount)',
  'function setAgentAuthorization(bytes32 workspaceId, bytes32 agentId, bool authorized)',
  // Custom errors MUST be declared here. Without them ethers cannot decode a revert and
  // reports "unknown custom error", which turns an expected, correct rejection into an
  // unreadable failure.
  'error WorkspaceExists()',
  'error UnknownWorkspace()',
  'error NotOperator()',
  'error AgentNotAuthorized()',
  'error InsufficientBudget(uint256 available, uint256 requested)',
  'error PurchaseAlreadyReserved(bytes32 operationId)',
  'error UnknownOperation()',
  'error ConflictingParameters()',
  'error InvalidState(uint8 current)',
  'error ReservationNotExpired()',
  'error SettlementUnknownBlocksRelease()',
];

/** String identifier to the bytes32 the contract stores. */
export const toId = (value: string): string => keccakString(value);

export interface BoundParameters {
  workspaceId: string;
  purchaseKey: string;
  amount: bigint;
  asset: string;
  payTo: string;
  resource: string;
}

/**
 * MUST match seed-testnet.js and any other producer exactly. This hash is what binds an
 * operation to its resource, asset, recipient and amount; a mismatch means the payment
 * module refuses to sign, which is the intended safety behaviour but looks like an
 * unexplained rejection if the encoding drifts.
 */
export function computeParamsHash(params: BoundParameters): string {
  return keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'bytes32', 'uint256', 'string', 'string', 'string'],
      [
        toId(params.workspaceId),
        toId(params.purchaseKey),
        params.amount,
        params.asset,
        params.payTo,
        params.resource,
      ],
    ),
  );
}

export interface OnChainOperation {
  workspaceId: string;
  purchaseKey: string;
  agentId: string;
  amount: bigint;
  expiresAt: number;
  policyVersion: number;
  status: ContractStatus;
  paramsHash: string;
}

/** Maps a contract revert to a typed error the orchestrator can branch on. */
export function translateRevert(err: unknown): CommonError {
  // ethers exposes the decoded custom error here when the ABI declares it.
  const revertName = (err as { revert?: { name?: string } })?.revert?.name ?? '';
  const text = `${revertName} ${String((err as { shortMessage?: string })?.shortMessage ?? err)}`;
  if (text.includes('PurchaseAlreadyReserved')) {
    return new CommonError('PURCHASE_PENDING', 'This purchase key is already claimed by another operation');
  }
  if (text.includes('InsufficientBudget')) {
    return new CommonError('INSUFFICIENT_BUDGET', 'Workspace budget cannot cover this amount');
  }
  if (text.includes('AgentNotAuthorized') || text.includes('NotOperator')) {
    return new CommonError('UNAUTHORIZED', 'Agent is not authorized for this workspace');
  }
  if (text.includes('SettlementUnknownBlocksRelease')) {
    return new CommonError('SETTLEMENT_UNKNOWN', 'Settlement is unknown; reconcile before releasing');
  }
  if (text.includes('ConflictingParameters')) {
    return new CommonError('UNAUTHORIZED', 'Operation id was reused with conflicting parameters');
  }
  if (text.includes('UnknownOperation') || text.includes('UnknownWorkspace')) {
    return new CommonError('NOT_FOUND', 'Unknown operation or workspace');
  }
  return new CommonError('NOT_FOUND', text.slice(0, 300));
}

export class BudgetClient {
  private readonly contract: Contract;

  constructor(address: string, jsonRpcUrl: string, privateKey: string) {
    const provider = new JsonRpcProvider(jsonRpcUrl);
    const key = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    this.contract = new Contract(address, ABI, new Wallet(key, provider));
  }

  async reserve(input: {
    operationId: string;
    agentId: string;
    ttlSeconds: number;
    params: BoundParameters;
  }): Promise<{ transactionHash: string; paramsHash: string }> {
    const paramsHash = computeParamsHash(input.params);
    try {
      const tx = await this.contract.getFunction('reserve')(
        toId(input.operationId),
        toId(input.params.workspaceId),
        toId(input.agentId),
        toId(input.params.purchaseKey),
        input.params.amount,
        input.params.asset,
        input.params.payTo,
        input.params.resource,
        input.ttlSeconds,
        paramsHash,
      );
      const receipt = await tx.wait();
      return { transactionHash: receipt.hash, paramsHash };
    } catch (err) {
      // Hedera's JSON-RPC relay does not reliably return decodable revert data, so a
      // legitimate rejection surfaces as "unknown custom error". Read the chain to
      // establish the real cause. The contract remains the authority — this only
      // explains a failure that already happened, so no race is introduced.
      throw await this.diagnoseReserveFailure(input.operationId, input.agentId, input.params, err);
    }
  }

  private async diagnoseReserveFailure(
    operationId: string,
    agentId: string,
    params: BoundParameters,
    original: unknown,
  ): Promise<CommonError> {
    try {
      const claim = await this.activeClaim(params.workspaceId, params.purchaseKey);
      const zero = `0x${'0'.repeat(64)}`;
      if (claim !== zero && claim !== toId(operationId)) {
        return new CommonError(
          'PURCHASE_PENDING',
          `Purchase key "${params.purchaseKey}" is already claimed by another operation`,
        );
      }

      // This operation already exists. If its bound parameters differ, the contract
      // rejected a reused operation id with conflicting terms — the guard that keeps
      // retries safe. Report it precisely rather than as a generic failure.
      if (claim === toId(operationId)) {
        const existing = await this.getOperation(operationId);
        if (existing.paramsHash !== computeParamsHash(params)) {
          return new CommonError(
            'UNAUTHORIZED',
            `Operation "${operationId}" already exists with different parameters. ` +
              'A retry must reuse the exact amount, asset, recipient and resource.',
          );
        }
      }

      if (!(await this.isAgentAuthorized(params.workspaceId, agentId))) {
        return new CommonError('UNAUTHORIZED', `Agent "${agentId}" is not authorized for this workspace`);
      }

      const available = await this.availableBudget(params.workspaceId);
      if (available < params.amount) {
        return new CommonError(
          'INSUFFICIENT_BUDGET',
          `Workspace has ${available} available, needs ${params.amount}`,
        );
      }
    } catch {
      /* diagnosis is best effort; fall through to the raw revert */
    }
    return translateRevert(original);
  }

  async isAgentAuthorized(workspaceId: string, agentId: string): Promise<boolean> {
    return (await this.contract.getFunction('isAgentAuthorized')(toId(workspaceId), toId(agentId))) as boolean;
  }

  private async send(method: string, ...args: unknown[]): Promise<string> {
    try {
      const tx = await this.contract.getFunction(method)(...args);
      const receipt = await tx.wait();
      return receipt.hash as string;
    } catch (err) {
      throw translateRevert(err);
    }
  }

  // --- workspace administration (operator only) --------------------------

  createWorkspace(workspaceId: string, operatorAddress: string): Promise<string> {
    return this.send('createWorkspace', toId(workspaceId), operatorAddress);
  }

  fundWorkspace(workspaceId: string, amount: bigint): Promise<string> {
    return this.send('fundWorkspace', toId(workspaceId), amount);
  }

  setAgentAuthorization(workspaceId: string, agentId: string, authorized: boolean): Promise<string> {
    return this.send('setAgentAuthorization', toId(workspaceId), toId(agentId), authorized);
  }

  /** The operator address this client signs as. */
  async operatorAddress(): Promise<string> {
    const runner = this.contract.runner as { getAddress?: () => Promise<string> };
    if (!runner.getAddress) throw new CommonError('UNAUTHORIZED', 'Client has no signer');
    return runner.getAddress();
  }

  // --- operation lifecycle -----------------------------------------------

  markPaymentPending(operationId: string): Promise<string> {
    return this.send('markPaymentPending', toId(operationId));
  }

  flagSettlementUnknown(operationId: string): Promise<string> {
    return this.send('flagSettlementUnknown', toId(operationId));
  }

  recordSettlement(operationId: string, transactionId: string, amount: bigint): Promise<string> {
    return this.send('recordSettlement', toId(operationId), transactionId, amount);
  }

  recordDelivery(
    operationId: string,
    usable: boolean,
    freshUntil: number,
    resultRef: string,
    failureReason: string,
  ): Promise<string> {
    return this.send('recordDelivery', toId(operationId), usable, freshUntil, resultRef, failureReason);
  }

  release(operationId: string): Promise<string> {
    return this.send('release', toId(operationId));
  }

  releaseAfterReconciliation(operationId: string): Promise<string> {
    return this.send('releaseAfterReconciliation', toId(operationId));
  }

  recordDecision(input: {
    workspaceId: string;
    decisionId: string;
    agentId: string;
    decisionType: number;
    operationId: string;
    hcsSequenceNumber: string;
  }): Promise<string> {
    return this.send(
      'recordDecision',
      toId(input.workspaceId),
      toId(input.decisionId),
      toId(input.agentId),
      input.decisionType,
      input.operationId ? toId(input.operationId) : `0x${'0'.repeat(64)}`,
      input.hcsSequenceNumber,
    );
  }

  async getOperation(operationId: string): Promise<OnChainOperation> {
    try {
      const raw = await this.contract.getFunction('getOperation')(toId(operationId));
      return {
        workspaceId: raw[0] as string,
        purchaseKey: raw[1] as string,
        agentId: raw[2] as string,
        amount: BigInt(raw[3]),
        expiresAt: Number(raw[4]),
        policyVersion: Number(raw[5]),
        status: Number(raw[6]) as ContractStatus,
        paramsHash: raw[7] as string,
      };
    } catch (err) {
      throw translateRevert(err);
    }
  }

  async availableBudget(workspaceId: string): Promise<bigint> {
    return BigInt(await this.contract.getFunction('availableBudget')(toId(workspaceId)));
  }

  async activeClaim(workspaceId: string, purchaseKey: string): Promise<string> {
    return (await this.contract.getFunction('activeClaim')(toId(workspaceId), toId(purchaseKey))) as string;
  }
}
