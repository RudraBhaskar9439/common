/**
 * Deploys CommonBudget. Reports the address and start block Aditya needs for the
 * subgraph manifest. Requires HEDERA_EVM_PRIVATE_KEY in the environment; never commit it.
 */
const hre = require('hardhat');

async function main() {
  if (hre.network.name !== 'hederaTestnet' || process.env.CONFIRM_TESTNET_PAYMENT !== 'yes' || (await hre.ethers.provider.getNetwork()).chainId !== 296n) throw new Error('Deployment requires explicit testnet transaction authorization');
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error('No signer. Set HEDERA_EVM_PRIVATE_KEY in the environment.');

  console.log(`network:  ${hre.network.name}`);
  console.log(`deployer: ${deployer.address}`);

  const factory = await hre.ethers.getContractFactory('CommonBudget');
  const contract = await factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const receipt = await contract.deploymentTransaction().wait();

  console.log('--- handoff for Aditya ---');
  console.log(`address:     ${address}`);
  console.log(`startBlock:  ${receipt.blockNumber}`);
  console.log(`chainId:     ${hre.network.config.chainId}`);
  console.log(`abi:         contracts/abi/CommonBudget.json`);
}

main().catch(() => {
  console.error('Deployment failed. Check testnet authorization and local configuration.');
  process.exitCode = 1;
});
