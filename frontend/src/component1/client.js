import { BrowserProvider, Contract, Interface, getAddress, id, sha256, randomBytes, hexlify } from 'ethers';
import artifact from '../../../shared/abis/MedicineTraceability.json' with { type: 'json' };
import { getMetaMaskProvider, describeWalletProvider } from '../component4/walletProvider.js';
// Reuse provider discovery only; Component 4's network switching is not invoked.
export const selectWalletProvider = options => getMetaMaskProvider(options);
export function watchWallet(ethereum, changed) {
  const events = ['accountsChanged', 'chainChanged', 'disconnect'];
  for (const event of events) ethereum?.on?.(event, changed);
  return () => { for (const event of events) ethereum?.removeListener?.(event, changed); };
}
export const abi = artifact.abi;
export const iface = new Interface(abi);
export const BASE = '/api/v1/traceability';
export const STAGES = ['Manufacturer', 'Distributor', 'Pharmacy'];
export function networkName(chainId) {
  const value = BigInt(chainId);
  if (value === 31337n) return 'Hardhat Local';
  if (value === 11155111n) return 'Ethereum Sepolia';
  throw new Error('Unsupported Component 1 network.');
}
export function settings(env = import.meta.env || {}) {
  const chainId = BigInt(env.VITE_TRACEABILITY_CHAIN_ID || '31337');
  networkName(chainId);
  return { address: env.VITE_TRACEABILITY_ADDRESS || '', chainId, startBlock: Number(env.VITE_TRACEABILITY_START_BLOCK || 0) };
}
export async function api(path, body, fetcher = fetch) {
  const response = await fetcher(BASE + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.message || 'Traceability request failed.');
  return result.data;
}
export const batchPath = batchId => `/batches/${encodeURIComponent(batchId)}`;
export async function loadBatch(batchId, request = api) {
  const path = batchPath(batchId);
  const [batch, pending, history, status] = await Promise.all([request(path), request(path + '/pending-transfer'), request(path + '/history'), request(path + '/status')]);
  return { ...batch['0'], pending: pending['0'], history: history['0'], expired: status.expired };
}
export async function walletContext(ethereum, account, config) {
  const name = networkName(config.chainId);
  if (!ethereum?.request) throw new Error('Enable an Ethereum wallet to continue.');
  const accounts = await ethereum.request({ method: 'eth_accounts' });
  if (!accounts[0] || getAddress(accounts[0]) !== getAddress(account)) throw new Error('Wallet account changed. Reconnect before continuing.');
  const actualChain = BigInt(await ethereum.request({ method: 'eth_chainId' }));
  if (actualChain !== config.chainId) throw new Error(`${describeWalletProvider(ethereum).name} reports chain ${actualChain} (0x${actualChain.toString(16)}). Select ${name} (chain ${config.chainId}) in that wallet, then reconnect.`);
  getAddress(config.address);
}
export async function connectWallet(ethereum, config) {
  if (!ethereum?.request) throw new Error('No injected wallet found. Install or enable your Ethereum wallet.');
  const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
  if (!accounts?.[0]) throw new Error('No wallet account connected. Unlock MetaMask and connect an account.');
  const account = getAddress(accounts[0]); await walletContext(ethereum, account, config);
  const provider = new BrowserProvider(ethereum);
  if (await provider.getCode(config.address) === '0x') throw new Error('No traceability contract at the configured address.');
  const contract = new Contract(config.address, abi, provider);
  const roles = {};
  for (const role of ['MANUFACTURER', 'DISTRIBUTOR', 'PHARMACY', 'RECALL']) roles[role] = await contract.hasRole(id(role + '_ROLE'), account);
  await walletContext(ethereum, account, config);
  return { account, roles, provider, contract, ethereum };
}
export function verifyPrepared(tx, expected, account, config) {
  networkName(config.chainId);
  if (getAddress(tx.from) !== getAddress(account) || getAddress(tx.to) !== getAddress(config.address) || BigInt(tx.chainId) !== config.chainId || BigInt(tx.value) !== 0n) throw new Error('Prepared transaction has an unexpected wallet, network, destination or value.');
  if (tx.data.toLowerCase() !== iface.encodeFunctionData(expected.method, expected.args).toLowerCase()) throw new Error('Prepared transaction does not match the reviewed action.');
}
export async function sendPrepared({ ethereum, account, config, tx, expected, onPending, makeProvider = value => new BrowserProvider(value) }) {
  verifyPrepared(tx, expected, account, config);
  await walletContext(ethereum, account, config);
  const provider = makeProvider(ethereum), signer = await provider.getSigner(account);
  await walletContext(ethereum, account, config);
  // Re-estimate instead of trusting a stale server gas limit.
  const response = await signer.sendTransaction({ to: tx.to, data: tx.data, value: 0n, chainId: config.chainId });
  onPending?.(response.hash);
  const receipt = await response.wait();
  if (!receipt || Number(receipt.status) !== 1) throw new Error('Transaction was not confirmed successfully.');
  return receipt;
}
export async function discover(session, fromBlock, toBlock) {
  if (!Number.isSafeInteger(fromBlock) || fromBlock < 0) throw new Error('Invalid deployment block configuration.');
  const end = Math.min(toBlock, fromBlock + 999);
  const logs = await session.provider.getLogs({ address: await session.contract.getAddress(), fromBlock, toBlock: end, topics: [[iface.getEvent('BatchRegistered').topicHash, iface.getEvent('TransferInitiated').topicHash]] });
  const ids = new Set();
  for (const log of logs) {
    const event = iface.parseLog(log);
    const involved = event.name === 'BatchRegistered' ? event.args.manufacturer : event.args.to;
    if (getAddress(involved) === getAddress(session.account)) ids.add(event.args.batchId);
  }
  return { ids: [...ids], nextBlock: end + 1 };
}
export function documentMessage({ host, method, path, digest, timestamp, nonce, address, chainId = 31337n }) {
  networkName(chainId);
  return `MediSafe Component 1 document request\nHost: ${host}\nChain: ${BigInt(chainId)}\nRegistry: ${getAddress(address)}\nMethod: ${method}\nPath: ${path}\nSHA256: ${digest}\nTime: ${timestamp}\nNonce: ${nonce}`;
}
export async function documentRequest({ ethereum, session, config, file, documentType, batchId, reference, fetcher = fetch, host = location.host }) {
  await walletContext(ethereum, session.account, config);
  let body, contentType, method = 'GET', path;
  if (file) {
    if (!file.size || file.size > 5 * 1024 * 1024 || !['application/pdf', 'image/png', 'image/jpeg'].includes(file.type)) throw new Error('Choose a PDF, PNG or JPEG up to 5 MiB.');
    const form = new FormData(); form.append('file', file); form.append('batchId', batchId); form.append('documentType', documentType); form.append('publicApproved', 'true');
    const encoded = new Request('http://localhost', { method: 'POST', body: form });
    body = new Uint8Array(await encoded.arrayBuffer()); contentType = encoded.headers.get('Content-Type');
    method = 'POST'; path = BASE + '/documents';
  } else {
    const cid = String(reference).replace(/^ipfs:\/\//, '');
    if (!/^[A-Za-z0-9]+$/.test(cid) || cid.length > 120) throw new Error('Invalid document reference.');
    path = BASE + '/documents/' + cid;
  }
  const digest = sha256(body || new Uint8Array()), timestamp = String(Date.now()), nonce = hexlify(randomBytes(16));
  const message = documentMessage({ host, method, path, digest, timestamp, nonce, address: config.address, chainId: config.chainId });
  const signer = await new BrowserProvider(ethereum).getSigner(session.account);
  const signature = await signer.signMessage(message);
  await walletContext(ethereum, session.account, config);
  const response = await fetcher(path, { method, body, headers: { ...(contentType ? { 'Content-Type': contentType } : {}), 'X-Document-Time': timestamp, 'X-Document-Nonce': nonce, 'X-Document-Signature': signature } });
  if (!response.ok) { const error = await response.json(); throw new Error(error.message || 'Document request failed.'); }
  if (method === 'POST') return (await response.json()).data;
  return response.blob();
}
export function registration(form) {
  const result = { ...form };
  for (const key of ['quantity', 'manufacturedAt', 'expiresAt']) {
    result[key] = key === 'quantity' ? Number(form[key]) : Math.floor(new Date(form[key]).getTime() / 1000);
    if (!Number.isSafeInteger(result[key]) || result[key] <= 0) throw new Error(`Enter a valid ${key}.`);
  }
  if (result.expiresAt <= result.manufacturedAt) throw new Error('Expiry must be after manufacture.');
  return result;
}
