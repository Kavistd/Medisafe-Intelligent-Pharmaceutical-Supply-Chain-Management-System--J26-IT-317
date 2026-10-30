const { expect } = require('chai');
const hre = require('hardhat');
const { deploymentPreflight } = require('../../scripts/lib/traceability-preflight');
const { HardhatEthersSigner } = require('@nomicfoundation/hardhat-ethers/signers');

describe('Component 1: read-only Sepolia deployment preflight', function () {
  let input, artifact, calls;
  beforeEach(async function () {
    artifact = await hre.artifacts.readArtifact('MedicineTraceability');
    calls = [];
    const provider = {
      send: async method => { calls.push(method); expect(method).to.equal('eth_chainId'); return '0xaa36a7'; },
      estimateGas: async tx => {
        expect(tx.to).to.equal(undefined);
        expect(tx.data).to.equal(artifact.bytecode + hre.ethers.AbiCoder.defaultAbiCoder().encode(['address'], [input.admin]).slice(2));
        return 19538993n;
      },
      getFeeData: async () => ({ maxFeePerGas: 1000030n, maxPriorityFeePerGas: 1000000n }),
      getBlock: async () => ({ number: 123, baseFeePerGas: 15n, gasLimit: 200000000n }),
      getBalance: async () => hre.ethers.parseEther('0.05'),
      call: async tx => { calls.push('eth_call'); expect(tx.gasLimit).to.equal(23446792n); return artifact.deployedBytecode; },
    };
    input = { network: 'sepolia', provider, artifact,
      signerAddress: '0x1111111111111111111111111111111111111111',
      admin: '0x1111111111111111111111111111111111111111' };
  });
  async function fails(message) {
    let error;
    try { await deploymentPreflight(input); } catch (value) { error = value; }
    expect(error, 'Expected preflight rejection').to.be.instanceOf(Error);
    expect(error.message).to.include(message);
  }
  it('accepts total gas above 2^24, budgets 20%, and simulates exact creation without sending', async function () {
    const { report, overrides } = await deploymentPreflight(input);
    expect(report.estimatedGas).to.equal(19538993n);
    expect(overrides.gasLimit).to.equal(23446792n);
    expect(overrides.chainId).to.equal(11155111);
    expect(report.maximumBudget).to.equal(23446792n * 1000030n);
    expect(report.remainingAfterBudget).to.equal(hre.ethers.parseEther('0.05') - report.maximumBudget);
    expect(report.estimatedCost).to.equal(19538993n * 1000015n);
    expect(report.addressesMatch).to.equal(true);
    expect(calls).to.deep.equal(['eth_chainId', 'eth_call', 'eth_chainId']);
  });
  it('rejects Mainnet and other named networks before contacting RPC', async function () {
    for (const network of ['mainnet', 'localhost']) { input.network = network; await fails('Sepolia'); }
    expect(calls).to.have.length(0);
  });
  it('rejects wrong RPC chain IDs', async function () {
    input.provider.send = async () => '0x1'; await fails('11155111');
  });
  it('rechecks chain after asynchronous simulation', async function () {
    let count = 0; input.provider.send = async () => ++count === 1 ? '0xaa36a7' : '0x1';
    await fails('11155111');
  });
  it('rejects insufficient funds before simulation', async function () {
    input.provider.getBalance = async () => 0n; await fails('Insufficient');
    expect(calls).not.to.include('eth_call');
  });
  it('rejects unavailable or inconsistent fee data', async function () {
    for (const fees of [{ maxFeePerGas: null, maxPriorityFeePerGas: null },
      { maxFeePerGas: 1n, maxPriorityFeePerGas: 1000000n }]) {
      input.provider.getFeeData = async () => fees; await fails('fees');
    }
  });
  it('rejects block and total gas-bound violations', async function () {
    input.provider.getBlock = async () => ({ baseFeePerGas: 15n, gasLimit: 20000000n });
    await fails('bounds');
    input.provider.getBlock = async () => ({ baseFeePerGas: 15n, gasLimit: 10000000000n });
    input.provider.estimateGas = async () => 4294967295n; await fails('bounds');
  });
  it('rejects unexpected simulated runtime or a reverted creation', async function () {
    input.provider.call = async () => '0x'; await fails('runtime');
    input.provider.call = async () => { throw new Error('Simulation rejected'); }; await fails('Simulation rejected');
  });
  it('rejects invalid admins and unexpected linked libraries', async function () {
    input.admin = hre.ethers.ZeroAddress; await fails('nonzero');
    input.admin = input.signerAddress; input.artifact = { ...artifact, linkReferences: { unexpected: {} } };
    await fails('linked libraries');
  });
  it('installed Hardhat signer preserves the explicit >2^24 gas budget at its intercepted send boundary', async function () {
    const { overrides } = await deploymentPreflight(input);
    let intercepted;
    const fakeProvider = { getBlockNumber: async () => 0, send: async (method, params) => {
      expect(method).to.equal('eth_sendTransaction'); intercepted = params[0];
      throw new Error('INTERCEPTED_NO_NETWORK');
    } };
    const signer = await HardhatEthersSigner.create(fakeProvider, input.signerAddress);
    const transaction = await new hre.ethers.ContractFactory(artifact.abi, artifact.bytecode).getDeployTransaction(input.admin, overrides);
    let error;
    try { await signer.sendTransaction(transaction); } catch (value) { error = value; }
    expect(error.message).to.equal('INTERCEPTED_NO_NETWORK');
    expect(BigInt(intercepted.gas)).to.equal(overrides.gasLimit);
    expect(BigInt(intercepted.chainId)).to.equal(11155111n);
    expect(intercepted.to).to.equal(undefined);
    expect(intercepted.data).to.equal(transaction.data);
    expect(BigInt(intercepted.maxFeePerGas)).to.equal(overrides.maxFeePerGas);
  });
  it('deployment script forwards validated gas and fee overrides to its intercepted deployment boundary', async function () {
    const deploy = require('../../scripts/deploy/deploy_traceability');
    input.provider.getNetwork = async () => ({ chainId: 11155111n });
    let captured;
    const runtime = { network: { name: 'sepolia' }, artifacts: hre.artifacts, ethers: {
      provider: input.provider,
      getSigners: async () => [{ getAddress: async () => input.signerAddress }],
      getContractFactory: async () => ({ deploy: async (admin, overrides) => {
        captured = { admin, overrides }; throw new Error('DEPLOYMENT_INTERCEPTED_NO_NETWORK');
      } }),
    } };
    let error;
    try { await deploy({ hre: runtime, env: { TRACEABILITY_ADMIN: input.admin, TRACEABILITY_ALLOW_SEPOLIA: 'true' }, quiet: true }); }
    catch (value) { error = value; }
    expect(error.message).to.equal('DEPLOYMENT_INTERCEPTED_NO_NETWORK');
    expect(captured.admin).to.equal(input.admin);
    expect(captured.overrides.gasLimit).to.equal(23446792n);
    expect(captured.overrides.chainId).to.equal(11155111);
    expect(captured.overrides.maxFeePerGas).to.equal(1000030n);
  });
});
