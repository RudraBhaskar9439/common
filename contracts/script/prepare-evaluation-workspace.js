/** Idempotent accounting setup. It never creates a purchase or a settlement event. */
async function prepareEvaluationWorkspace(contract, ethers, workspaceName, operator, targetBudget) {
  if (!workspaceName || targetBudget <= 0n || targetBudget > 500000000n) throw new Error('Use a workspace and a target accounting budget of at most 5 testnet HBAR');
  const workspace = ethers.id(workspaceName);
  const transactions = [];
  const send = async promise => { const receipt = await (await promise).wait(); transactions.push(receipt.hash); };
  let current;
  try { current = await contract.getWorkspace(workspace); }
  catch (err) {
    let name = err.revert?.name;
    try { if (!name && typeof err.data === 'string') name = contract.interface.parseError(err.data)?.name; } catch { /* Unknown RPC errors must not trigger setup. */ }
    if (name !== 'UnknownWorkspace') throw err;
    await send(contract.createWorkspace(workspace, operator));
    current = await contract.getWorkspace(workspace);
  }
  if (current.operator.toLowerCase() !== operator.toLowerCase()) throw new Error('Workspace belongs to another operator');
  if (current.budget < targetBudget) await send(contract.fundWorkspace(workspace, targetBudget - current.budget));
  for (const agent of ['agent-a', 'agent-b']) if (!await contract.isAgentAuthorized(workspace, ethers.id(agent))) await send(contract.setAgentAuthorization(workspace, ethers.id(agent), true));
  return transactions;
}
module.exports = { prepareEvaluationWorkspace };

if (require.main === module) {
  const hre = require('hardhat');
  (async () => {
    if (process.env.CONFIRM_TESTNET_PAYMENT !== 'yes' || hre.network.name !== 'hederaTestnet' || (await hre.ethers.provider.getNetwork()).chainId !== 296n) throw new Error('Explicit testnet transaction authorization required');
    const address = process.env.COMMON_CONTRACT_ADDRESS;
    const workspace = process.env.COMMON_WORKSPACE_ID;
    if (!address || !workspace) throw new Error('Set COMMON_CONTRACT_ADDRESS and COMMON_WORKSPACE_ID');
    const [operator] = await hre.ethers.getSigners();
    const contract = await hre.ethers.getContractAt('CommonBudget', address);
    const transactions = await prepareEvaluationWorkspace(contract, hre.ethers, workspace, operator.address, BigInt(process.env.WORKSPACE_BUDGET_TINYBAR || '100000000'));
    console.log(JSON.stringify({ workspace, accountingOnly: true, transactions }, null, 2));
  })().catch(() => { console.error('Workspace preparation failed. Check testnet configuration, contract/operator and budget; no keys are printed.'); process.exitCode = 1; });
}
