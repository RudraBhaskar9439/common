const { expect } = require('chai');
const { ethers } = require('hardhat');
const { prepareEvaluationWorkspace } = require('../script/prepare-evaluation-workspace');

describe('evaluation workspace setup on local Hardhat only', () => {
  it('authorizes both agents once and does not inflate the budget when rerun', async () => {
    const [operator] = await ethers.getSigners();
    const budget = await (await ethers.getContractFactory('CommonBudget')).deploy();
    expect(await prepareEvaluationWorkspace(budget, ethers, 'evaluation', operator.address, 100000000n)).to.have.length(4);
    expect(await prepareEvaluationWorkspace(budget, ethers, 'evaluation', operator.address, 100000000n)).to.have.length(0);
    expect(await budget.availableBudget(ethers.id('evaluation'))).to.equal(100000000n);
    expect(await budget.isAgentAuthorized(ethers.id('evaluation'), ethers.id('agent-b'))).to.equal(true);
  });
  it('refuses an existing foreign operator before funding or authorizing', async () => {
    const [operator, outsider] = await ethers.getSigners();
    const budget = await (await ethers.getContractFactory('CommonBudget')).deploy();
    await budget.createWorkspace(ethers.id('evaluation'), outsider.address);
    await expect(prepareEvaluationWorkspace(budget, ethers, 'evaluation', operator.address, 100000000n)).to.be.rejectedWith('another operator');
    expect((await budget.getWorkspace(ethers.id('evaluation'))).budget).to.equal(0n);
  });
});
