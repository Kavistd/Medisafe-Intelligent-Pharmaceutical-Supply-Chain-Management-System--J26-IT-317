import { Contract, JsonRpcProvider, FetchRequest, id, verifyMessage, sha256 } from 'ethers';
import artifact from '../shared/abis/MedicineTraceability.json' with { type: 'json' };
import { documentMessage } from './src/component1/client.js';

// Local research adapter. The operator token is never bundled or sent to the browser.
export function documentGateway(env, { fetcher = fetch, roleCheck } = {}) {
  const used = new Map(); let active = 0;
  let provider;
  const check = roleCheck || (async (account, upload) => {
    if (!provider) {
      const request = new FetchRequest(env.TRACEABILITY_RPC_URL || 'http://127.0.0.1:8545');
      request.timeout = 10000;
      provider = new JsonRpcProvider(request);
    }
    if ((await provider.getNetwork()).chainId !== 31337n) throw new Error();
    const contract = new Contract(env.VITE_TRACEABILITY_ADDRESS, artifact.abi, provider);
    const roles = upload ? ['MANUFACTURER'] : ['MANUFACTURER', 'DISTRIBUTOR', 'PHARMACY', 'RECALL'];
    for (const role of roles) if (await contract.hasRole(id(role + '_ROLE'), account)) return true;
    return false;
  });
  return async (req, res, next) => {
    if (!req.url?.startsWith('/api/v1/traceability/documents')) return next();
    const deny = (status, message) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify({ success: false, message })); };
    if (active >= 2) return deny(429, 'Document requests are busy. Retry shortly.');
    active++;
    try {
      const path = req.url;
      if (!((req.method === 'POST' && path === '/api/v1/traceability/documents') || (req.method === 'GET' && /^\/api\/v1\/traceability\/documents\/[A-Za-z0-9]{1,120}$/.test(path)))) return deny(400, 'Invalid document path.');
      if (!env.IPFS_API_TOKEN || env.IPFS_API_TOKEN.length < 32) return deny(503, 'Server document authorization is not configured.');
      const timestamp = req.headers['x-document-time'], nonce = req.headers['x-document-nonce'], signature = req.headers['x-document-signature'];
      if (!/^\d{13}$/.test(timestamp || '') || Math.abs(Date.now() - Number(timestamp)) > 60000 || !/^0x[0-9a-f]{32}$/.test(nonce || '') || typeof signature !== 'string') return deny(401, 'A fresh wallet-signed document request is required.');
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 5 * 1024 * 1024 + 8192) return deny(413, 'Document upload is too large.'); chunks.push(chunk); }
      const body = Buffer.concat(chunks);
      if (req.method === 'GET' && size) return deny(400, 'Unexpected download body.');
      const message = documentMessage({ host: req.headers.host, method: req.method, path, digest: sha256(body), timestamp, nonce, address: env.VITE_TRACEABILITY_ADDRESS });
      let account;
      try { account = verifyMessage(message, signature); } catch { return deny(401, 'Invalid document signature.'); }
      if (!(await check(account, req.method === 'POST'))) return deny(403, 'This wallet lacks the required document role.');
      // Body/signature verification and asynchronous role authorization must finish
      // before committing authorization. Failed preflight requests consume no nonce.
      const now = Date.now();
      if (Math.abs(now - Number(timestamp)) > 60000) return deny(401, 'Document signature expired before authorization completed.');
      for (const [key, expiry] of used) if (expiry < now) used.delete(key);
      const nonceKey = `${account}:${nonce}`;
      // No await between lookup and insertion: this is atomic in this process,
      // including when concurrent request bodies and role checks finish together.
      if (used.has(nonceKey) || used.size >= 1000) return deny(429, 'Request already used or document rate limit reached.');
      used.set(nonceKey, Number(timestamp) + 60000);
      // Once forwarding can have side effects, keep the nonce consumed even if
      // the backend fails or times out: execution may already have occurred.
      const target = new URL(path, 'http://127.0.0.1:5001');
      const response = await fetcher(target, { method: req.method, headers: { Authorization: `Bearer ${env.IPFS_API_TOKEN}`, ...(req.method === 'POST' ? { 'Content-Type': req.headers['content-type'] || '' } : {}) }, body: req.method === 'POST' ? body : undefined, redirect: 'error', signal: AbortSignal.timeout(35000) });
      const parts = []; let received = 0;
      for await (const chunk of response.body) { received += chunk.length; if (received > 5 * 1024 * 1024) throw new Error(); parts.push(chunk); }
      res.statusCode = response.status;
      for (const name of ['content-type', 'content-disposition', 'content-security-policy']) { const value = response.headers.get(name); if (value) res.setHeader(name, value); }
      res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store'); res.end(Buffer.concat(parts));
    } catch { deny(502, 'Document gateway unavailable. Check local services and configuration.'); }
    finally { active--; }
  };
}
