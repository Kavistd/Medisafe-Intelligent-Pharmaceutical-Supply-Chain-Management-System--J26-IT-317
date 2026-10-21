const { Contract, Interface, JsonRpcProvider, FetchRequest, getAddress, ZeroAddress } = require('ethers');
const artifact = require('../../../shared/abis/MedicineTraceability.json');
const addresses = require('../../../shared/blockchain/contract-addresses.json');
const abi = artifact.abi || artifact;
const contractInterface = new Interface(abi);
const networks = { localhost: 31337, hardhat: 31337, sepolia: 11155111 };

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function loadSettings(env = process.env) {
  const network = (env.TRACEABILITY_NETWORK || 'localhost').trim().toLowerCase();
  const chainId = networks[network];
  if (!chainId) throw new ApiError(503, 'CONFIGURATION_ERROR', 'Unsupported TRACEABILITY_NETWORK.');
  let address;
  try {
    const url = new URL(env.WEB3_RPC_URL);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    address = getAddress((env.MEDICINE_TRACEABILITY_ADDRESS || addresses[network]?.MedicineTraceability || '').trim());
    if (address === ZeroAddress) throw new Error();
  } catch { throw new ApiError(503, 'CONFIGURATION_ERROR', 'Configure a valid RPC URL and MedicineTraceability address.'); }
  const startBlock = Number(env.TRACEABILITY_START_BLOCK || 0);
  if (!Number.isSafeInteger(startBlock) || startBlock < 0) throw new ApiError(503, 'CONFIGURATION_ERROR', 'Invalid TRACEABILITY_START_BLOCK.');
  return { rpcUrl: env.WEB3_RPC_URL, address, chainId, startBlock };
}

class TraceabilityClient {
  constructor(settings, provider) {
    this.settings = settings;
    const request = new FetchRequest(settings.rpcUrl);
    request.timeout = 10000;
    this.provider = provider || new JsonRpcProvider(request);
    this.contract = new Contract(settings.address, abi, this.provider);
  }
  async ready() {
    // Query chain ID each time, rather than trusting a cached provider network.
    const chainId = BigInt(await this.provider.send('eth_chainId', []));
    if (chainId !== BigInt(this.settings.chainId)) throw new ApiError(503, 'CHAIN_MISMATCH', 'RPC chain does not match TRACEABILITY_NETWORK.');
    const code = await this.provider.getCode(this.settings.address);
    if (!code || code === '0x') throw new ApiError(503, 'CONTRACT_UNAVAILABLE', 'No deployed contract at the configured address.');
  }
  async read(method, args) {
    await this.ready();
    // ABI encoding/decoding preserves tuple field names and arbitrary uint256 values.
    const data = this.contract.interface.encodeFunctionData(method, args);
    const result = await this.provider.call({ to: this.settings.address, data });
    const decoded = this.contract.interface.decodeFunctionResult(method, result);
    const convert = (value, type) => {
      if (type.baseType === 'array') return Array.from(value, item => convert(item, type.arrayChildren));
      if (type.baseType === 'tuple') return Object.fromEntries(type.components.map((field, i) => [field.name, convert(value[i], field)]));
      return value;
    };
    return Object.fromEntries(this.contract.interface.getFunction(method).outputs.map((type, i) => [String(i), convert(decoded[i], type)]));
  }
  async network() {
    await this.ready();
    return { chainId: this.settings.chainId, address: this.settings.address, startBlock: this.settings.startBlock || 0, headBlock: await this.provider.getBlockNumber() };
  }
  async discovery({ fromBlock, headBlock, windowSize, direction = 'forward' } = {}) {
    await this.ready();
    const latest = await this.provider.getBlockNumber();
    const startBlock = this.settings.startBlock || 0;
    const integer = (value, fallback) => {
      if (value === undefined) return fallback;
      if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid block cursor.');
      return Number(value);
    };
    if (!['forward', 'backward'].includes(direction)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid scan direction.');
    const backward = direction === 'backward';
    const head = integer(headBlock, latest), from = integer(fromBlock, backward ? head : startBlock);
    const invalidBackward = head < startBlock ? from !== head : from < Math.max(0, startBlock - 1) || from > head;
    if (head > latest || (backward ? invalidBackward : from < startBlock || from > Math.max(startBlock, head + 1))) throw new ApiError(400, 'VALIDATION_ERROR', 'Block cursor is outside the configured scan range.');
    const window = integer(windowSize, 1000);
    if (window < 1 || window > 1000) throw new ApiError(400, 'VALIDATION_ERROR', 'Scan window must be between 1 and 1000 blocks.');
    let low = backward ? Math.max(startBlock, from - window + 1) : from;
    let end = backward ? from : Math.min(head, from + window - 1), logs = [];
    const done = backward ? from < startBlock || head < startBlock : from > head;
    if (!done) {
      for (;;) {
        try {
          logs = await this.provider.getLogs({ address: this.settings.address, fromBlock: low, toBlock: end, topics: [contractInterface.getEvent('BatchRegistered').topicHash] });
          break;
        } catch (error) {
          // Retry only range/result-limit errors, never authentication/outage errors.
          const code = error?.info?.error?.code ?? error?.code;
          const message = String(error?.info?.error?.message || error?.message || '');
          const rangeLimited = code === -32005 || /block range|too many results|response size|limit.*blocks|query.*limit/i.test(message);
          if (!rangeLimited || end <= low) throw error;
          if (backward) low = end - Math.floor((end - low) / 2);
          else end = low + Math.floor((end - low) / 2);
        }
      }
    }
    const ids = [...new Set(logs.filter(log => !log.removed).map(log => contractInterface.parseLog(log).args.batchId))];
    return { chainId: this.settings.chainId, address: this.settings.address, startBlock, headBlock: head,
      direction, fromBlock: low, toBlock: end, windowSize: done ? window : end - low + 1,
      nextBlock: done ? from : backward ? low - 1 : end + 1, complete: done || (backward ? low === startBlock : end === head), ids };
  }
  async prepare(method, args, sender) {
    await this.ready();
    const transaction = { from: sender, to: this.settings.address,
      data: contractInterface.encodeFunctionData(method, args), value: '0x0' };
    // Simulate as the supplied sender: actual contract permissions and lifecycle
    // rules remain authoritative. This never proves the caller owns that wallet.
    await this.provider.call(transaction);
    const gasLimit = await this.provider.estimateGas(transaction);
    return { ...transaction, chainId: this.settings.chainId, gasLimit: gasLimit.toString() };
  }
}

function publicError(error) {
  if (error instanceof ApiError) return error;
  // Only decode known revert data. Never return raw provider errors or URLs.
  const data = error?.data || error?.info?.error?.data?.data || error?.info?.error?.data;
  let parsed;
  try { if (typeof data === 'string') parsed = contractInterface.parseError(data); } catch {}
  try { if (!parsed && error?.revert?.name && contractInterface.getError(error.revert.name)) parsed = error.revert; } catch {}
  if (parsed) {
    const name = parsed.name;
    const forbidden = ['AccessControlUnauthorizedAccount', 'NotCurrentOwner', 'NotRecipient', 'NotTransferParticipant', 'InvalidParticipantRole'];
    const status = name === 'BatchNotFound' ? 404 : forbidden.includes(name) ? 403 : ['InvalidField', 'InvalidRecipient'].includes(name) ? 400 : 409;
    return new ApiError(status, name, `Contract rejected the request: ${name}.`);
  }
  return new ApiError(503, 'BLOCKCHAIN_UNAVAILABLE', 'Blockchain request failed. Check RPC configuration and availability.');
}

module.exports = { ApiError, TraceabilityClient, loadSettings, publicError, contractInterface };
