const { ContractFactory } = require('ethers');
const { address } = require('./traceability');

// EIP-8037 permits total gas above EIP-7825's execution-only cap.
// Standard estimateGas does not expose an execution/state breakdown: never invent one.
const TOTAL_GAS_CEILING = 4294967295n;
async function deploymentPreflight({ network, provider, artifact, signerAddress, admin }) {
  if (network !== 'sepolia') throw new Error('Preflight requires the Sepolia network.');
  const sender = address(signerAddress, 'Deployment signer');
  const administrator = address(admin, 'TRACEABILITY_ADMIN');
  const assertChain = async () => {
    if (BigInt(await provider.send('eth_chainId', [])) !== 11155111n)
      throw new Error('Preflight requires chain ID 11155111.');
  };
  await assertChain();
  if (Object.keys(artifact.linkReferences || {}).length || Object.keys(artifact.deployedLinkReferences || {}).length)
    throw new Error('Unexpected linked libraries.');
  const transaction = { ...await new ContractFactory(artifact.abi, artifact.bytecode).getDeployTransaction(administrator), from: sender };
  const estimatedGas = await provider.estimateGas(transaction);
  if (estimatedGas <= 0n) throw new Error('Invalid deployment gas estimate.');
  const gasLimit = (estimatedGas * 120n + 99n) / 100n;
  const fees = await provider.getFeeData();
  const block = await provider.getBlock('latest');
  if (!block || block.baseFeePerGas == null || fees.maxFeePerGas == null || fees.maxPriorityFeePerGas == null ||
      fees.maxFeePerGas <= 0n || fees.maxPriorityFeePerGas < 0n ||
      fees.maxFeePerGas < block.baseFeePerGas + fees.maxPriorityFeePerGas)
    throw new Error('Usable EIP-1559 fees unavailable.');
  if (gasLimit > TOTAL_GAS_CEILING || gasLimit > block.gasLimit)
    throw new Error('Deployment gas budget exceeds total or block gas bounds.');
  const overrides = { gasLimit, chainId: 11155111, maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas, value: 0n };
  const budget = gasLimit * fees.maxFeePerGas;
  const balance = await provider.getBalance(sender);
  if (balance < budget) throw new Error('Insufficient SepoliaETH for deployment gas budget.');
  // eth_call executes creation without persisting a contract or consuming a nonce.
  const runtime = await provider.call({ ...transaction, ...overrides });
  if (runtime.toLowerCase() !== artifact.deployedBytecode.toLowerCase())
    throw new Error('Creation simulation returned unexpected runtime bytecode.');
  await assertChain();
  return { overrides, report: { network: 'sepolia', chainId: 11155111, signerAddress: sender,
    administratorAddress: administrator, addressesMatch: sender === administrator, blockNumber: block.number,
    creationBytes: (artifact.bytecode.length - 2) / 2, runtimeBytes: (artifact.deployedBytecode.length - 2) / 2,
    estimatedGas, gasLimit, baseFeePerGas: block.baseFeePerGas, maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    estimatedCost: estimatedGas * (block.baseFeePerGas + fees.maxPriorityFeePerGas),
    maximumBudget: budget, balance, remainingAfterBudget: balance - budget,
    simulationRuntimeMatches: true, gasBreakdown: 'Execution/state split unavailable from standard RPC estimation' } };
}
module.exports = { deploymentPreflight };
