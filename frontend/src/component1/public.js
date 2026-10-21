import { getAddress } from 'ethers';
import { api } from './client.js';

export function verifyDeployment(value, config) {
  if (BigInt(value.chainId) !== config.chainId || getAddress(value.address) !== getAddress(config.address)) throw new Error('Network or contract does not match this application. Verification unavailable.');
}
export async function discoverPublic(config, cursor, request = api) {
  // HMR or an older saved cursor must not turn a forward scan into a partial
  // backward scan and silently skip the newest registrations.
  if (cursor?.direction !== 'backward') cursor = null;
  const query = cursor ? `?fromBlock=${cursor.nextBlock}&headBlock=${cursor.headBlock}${cursor.windowSize ? `&windowSize=${cursor.windowSize}` : ''}&direction=backward` : '?direction=backward';
  const result = await request('/batches' + query);
  verifyDeployment(result, config);
  if (result.startBlock !== config.startBlock) throw new Error('Frontend and backend deployment blocks do not match. Scan unavailable.');
  return result;
}
export function batchPage(rows, search, stage, page, size = 10) {
  const needle = search.toLowerCase();
  const filtered = rows.filter(row => (row.data.batchId.toLowerCase().includes(needle) || row.data.name.toLowerCase().includes(needle)) && (stage === '' || String(row.stage) === stage));
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const current = Math.min(Math.max(1, page), pages);
  return { rows: filtered.slice((current - 1) * size, current * size), count: filtered.length, pages, page: current };
}
export function scanRetryDelay(error, failures) {
  const transient = error instanceof TypeError || /blockchain request failed|RPC unavailable|failed to fetch|network error/i.test(error?.message || '');
  return transient && failures < 4 ? 1000 * 2 ** failures : null;
}
export function scanProgress(cursor) {
  if (!cursor) return 'Discovering recent registrations first. Scan incomplete.';
  if (cursor.direction !== 'backward') return 'Scan incomplete. Refresh or continue to discover recent registrations first.';
  if (cursor.complete) return `Complete through block ${cursor.headBlock.toLocaleString()}.`;
  const total = Math.max(1, cursor.headBlock - cursor.startBlock + 1);
  const scanned = cursor.headBlock - cursor.fromBlock + 1;
  return `Scanning newest first: ${scanned.toLocaleString()} of ${total.toLocaleString()} blocks (${Math.floor(100 * scanned / total)}%). List incomplete; older batches are still being discovered.`;
}
