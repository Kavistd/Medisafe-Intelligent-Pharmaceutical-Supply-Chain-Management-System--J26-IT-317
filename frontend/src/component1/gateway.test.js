import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Wallet, sha256 } from 'ethers';
import { documentGateway } from '../../component1-document-gateway.js';
import { documentMessage, iface } from './client.js';
const env = { IPFS_API_TOKEN: 'server-only-operator-token-'.repeat(2), VITE_TRACEABILITY_ADDRESS: '0x2222222222222222222222222222222222222222' };
async function serve(options, run) {
  const { onRequest, environment = env, ...gatewayOptions } = options;
  const middleware = documentGateway(environment, gatewayOptions);
  const server = http.createServer((req, res) => {
    middleware(req, res, () => { res.statusCode = 404; res.end(); });
    onRequest?.();
  });
  server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const root = `http://127.0.0.1:${server.address().port}`;
  try { await run(root); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
function deferred() {
  let resolve; const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function pausedRequest(root, options) {
  let request;
  const result = new Promise((resolve, reject) => {
    request = http.request(root + '/api/v1/traceability/documents', { method: options.method,
      headers: { ...options.headers, 'Content-Length': options.body.length } }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject); request.flushHeaders();
  });
  return { request, result };
}
async function signed(root, { wallet = Wallet.createRandom(), chainId = 31337n, method = 'POST', path = '/api/v1/traceability/documents', body = Buffer.from('fixture'), timestamp = String(Date.now()), nonce = '0x' + 'aa'.repeat(16) } = {}) {
  const message = documentMessage({ host: new URL(root).host, method, path, digest: sha256(body), timestamp, nonce, address: env.VITE_TRACEABILITY_ADDRESS, chainId });
  return { method, body: method === 'GET' ? undefined : body, headers: { 'Content-Type': 'multipart/form-data; boundary=test', 'X-Document-Time': timestamp, 'X-Document-Nonce': nonce, 'X-Document-Signature': await wallet.signMessage(message) } };
}

for (const chainId of [31337n, 11155111n]) {
  test(`gateway validates live RPC chain ${chainId} before role queries and forwarding`, async () => {
    let rpcChain = chainId, calls = 0, roleCalls = 0;
    await serve({ environment: { ...env, VITE_TRACEABILITY_CHAIN_ID: String(chainId) },
      makeProvider: () => ({ send: async method => { assert.equal(method, 'eth_chainId'); return '0x' + rpcChain.toString(16); },
        call: async () => { roleCalls++; return iface.encodeFunctionResult('hasRole', [true]); } }),
      fetcher: async () => { calls++; return Response.json({ success: true }); } }, async root => {
      assert.equal((await fetch(root + '/api/v1/traceability/documents', await signed(root, { chainId }))).status, 200);
      assert.equal(roleCalls, 1);
      rpcChain = chainId === 31337n ? 11155111n : 31337n;
      assert.equal((await fetch(root + '/api/v1/traceability/documents', await signed(root, { chainId }))).status, 502);
      assert.equal(roleCalls, 1); assert.equal(calls, 1);
    });
  });
  test(`document signatures cannot cross from another chain into ${chainId}`, async () => {
    const wallet = Wallet.createRandom(); let calls = 0;
    await serve({ environment: { ...env, VITE_TRACEABILITY_CHAIN_ID: String(chainId) },
      roleCheck: async account => account === wallet.address,
      fetcher: async () => { calls++; return Response.json({ success: true }); } }, async root => {
      const path = '/api/v1/traceability/documents';
      const other = chainId === 31337n ? 11155111n : 31337n;
      assert.equal((await fetch(root + path, await signed(root, { wallet, chainId: other }))).status, 403);
      assert.equal(calls, 0);
      assert.equal((await fetch(root + path, await signed(root, { wallet, chainId }))).status, 200);
    });
  });
}
test('unsigned and unauthorized uploads never receive operator credentials', async () => {
  let calls = 0;
  await serve({ roleCheck: async () => false, fetcher: async () => { calls++; } }, async root => {
    const path = '/api/v1/traceability/documents';
    assert.equal((await fetch(root + path, { method: 'POST', body: 'unsigned' })).status, 401);
    assert.equal((await fetch(root + path, await signed(root))).status, 403);
    assert.equal(calls, 0);
  });
});
test('signed role-authorized request forwards server token only to fixed Component 1 backend', async () => {
  await serve({ roleCheck: async (_account, upload) => { assert.equal(upload, true); return true; }, fetcher: async (url, options) => {
    assert.equal(url.href, 'http://127.0.0.1:5001/api/v1/traceability/documents');
    assert.equal(options.headers.Authorization, 'Bearer ' + env.IPFS_API_TOKEN);
    assert.equal(options.redirect, 'error'); assert.equal(options.body.toString(), 'fixture');
    return Response.json({ success: true, data: { cid: 'fixture' } });
  } }, async root => {
    const res = await fetch(root + '/api/v1/traceability/documents', await signed(root));
    assert.equal(res.status, 200); assert.ok(!(await res.text()).includes(env.IPFS_API_TOKEN));
  });
});
test('replayed, expired and body-tampered signatures fail closed', async () => {
  let calls = 0;
  await serve({ roleCheck: async () => true, fetcher: async () => { calls++; return Response.json({ success: true }); } }, async root => {
    const path = '/api/v1/traceability/documents';
    const options = await signed(root);
    assert.equal((await fetch(root + path, options)).status, 200);
    assert.equal((await fetch(root + path, options)).status, 429);
    assert.equal((await fetch(root + path, await signed(root, { timestamp: String(Date.now() - 120000), nonce: '0x' + 'bb'.repeat(16) }))).status, 401);
    // A changed body recovers another address; only the original authorized
    // signer may use the operator capability.
    assert.equal(calls, 1);
  });
  const wallet = Wallet.createRandom();
  await serve({ roleCheck: async account => account === wallet.address, fetcher: async () => { throw new Error('must not forward'); } }, async root => {
    const options = await signed(root, { wallet }); options.body = Buffer.from('tampered');
    assert.equal((await fetch(root + '/api/v1/traceability/documents', options)).status, 403);
  });
});
test('safe download headers are retained and upstream failure details are redacted', async () => {
  await serve({ roleCheck: async (_account, upload) => !upload, fetcher: async () => new Response('bytes', { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="document.pdf"', 'Content-Security-Policy': "default-src 'none'; sandbox" } }) }, async root => {
    const path = '/api/v1/traceability/documents/bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const res = await fetch(root + path, await signed(root, { method: 'GET', path, body: Buffer.alloc(0) }));
    assert.equal(res.status, 200); assert.match(res.headers.get('content-disposition'), /^attachment/); assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });
  await serve({ roleCheck: async () => true, fetcher: async () => { throw new Error(env.IPFS_API_TOKEN); } }, async root => {
    const res = await fetch(root + '/api/v1/traceability/documents', await signed(root));
    assert.equal(res.status, 502); assert.ok(!(await res.text()).includes(env.IPFS_API_TOKEN));
  });
});

test('concurrent duplicate bodies and role checks permit exactly one forwarding', { timeout: 10000 }, async () => {
  const bodiesWaiting = deferred(), rolesWaiting = deferred(), releaseRoles = deferred();
  let arrived = 0, checked = 0, calls = 0;
  await serve({ onRequest: () => { if (++arrived === 2) bodiesWaiting.resolve(); },
    roleCheck: async () => { if (++checked === 2) rolesWaiting.resolve(); await releaseRoles.promise; return true; },
    fetcher: async () => { calls++; return Response.json({ success: true }); } }, async root => {
    const options = await signed(root);
    const first = pausedRequest(root, options), second = pausedRequest(root, options);
    await bodiesWaiting.promise;
    first.request.end(options.body); second.request.end(options.body);
    await rolesWaiting.promise;
    releaseRoles.resolve();
    assert.deepEqual((await Promise.all([first.result, second.result])).sort(), [200, 429]);
    assert.equal(calls, 1);
    assert.equal((await fetch(root + '/api/v1/traceability/documents', options)).status, 429);
  });
});

test('body delay past signature expiry is rejected after receiving all bytes', { timeout: 10000 }, async () => {
  const arrived = deferred(); let calls = 0;
  await serve({ onRequest: arrived.resolve, roleCheck: async () => true,
    fetcher: async () => { calls++; return Response.json({ success: true }); } }, async root => {
    const options = await signed(root), originalNow = Date.now;
    const request = pausedRequest(root, options);
    await arrived.promise;
    try {
      Date.now = () => Number(options.headers['X-Document-Time']) + 60001;
      request.request.end(options.body);
      assert.equal(await request.result, 401); assert.equal(calls, 0);
    } finally { Date.now = originalNow; }
  });
});

test('signature expiring during role authorization is rejected without consuming its nonce', { timeout: 10000 }, async () => {
  const entered = deferred(), release = deferred(); let checks = 0, calls = 0;
  await serve({ roleCheck: async () => { if (++checks === 1) { entered.resolve(); await release.promise; } return true; },
    fetcher: async () => { calls++; return Response.json({ success: true }); } }, async root => {
    const path = '/api/v1/traceability/documents', wallet = Wallet.createRandom(); const options = await signed(root, { wallet });
    const first = fetch(root + path, options);
    await entered.promise;
    const originalNow = Date.now;
    try {
      Date.now = () => Number(options.headers['X-Document-Time']) + 60001;
      release.resolve(); assert.equal((await first).status, 401); assert.equal(calls, 0);
    } finally { Date.now = originalNow; release.resolve(); }
    // A new, fresh authorization may reuse a nonce that never committed.
    const fresh = await signed(root, { wallet, nonce: options.headers['X-Document-Nonce'] });
    assert.equal((await fetch(root + path, fresh)).status, 200); assert.equal(calls, 1);
  });
});

test('invalid signature, unauthorized role, role-check error and oversized body do not burn a valid nonce', async () => {
  const wallet = Wallet.createRandom(); let mode = 'denied', calls = 0;
  await serve({ roleCheck: async account => {
    if (mode === 'throw') throw new Error('Role RPC unavailable');
    return mode === 'allowed' && account === wallet.address;
  }, fetcher: async () => { calls++; return Response.json({ success: true }); } }, async root => {
    const path = '/api/v1/traceability/documents', options = await signed(root, { wallet });
    const badSignature = { ...options, headers: { ...options.headers, 'X-Document-Signature': '0x00' } };
    assert.equal((await fetch(root + path, badSignature)).status, 401);
    assert.equal((await fetch(root + path, options)).status, 403);
    mode = 'throw'; assert.equal((await fetch(root + path, options)).status, 502);
    mode = 'allowed';
    assert.equal((await fetch(root + path, { ...options, body: Buffer.from('tampered') })).status, 403);
    assert.equal((await fetch(root + path, { ...options, body: Buffer.alloc(5 * 1024 * 1024 + 8193) })).status, 413);
    assert.equal(calls, 0);
    assert.equal((await fetch(root + path, options)).status, 200);
    assert.equal((await fetch(root + path, options)).status, 429);
    assert.equal(calls, 1);
  });
});

test('a forwarded request stays consumed when the upstream fails or returns an error', async () => {
  for (const failure of ['timeout', 'rejection']) {
    let calls = 0;
    await serve({ roleCheck: async () => true, fetcher: async () => {
      calls++;
      if (failure === 'timeout') throw new Error('Possibly executed before timeout');
      return Response.json({ success: false, message: 'Document not approved' }, { status: 403 });
    } }, async root => {
      const path = '/api/v1/traceability/documents', options = await signed(root);
      assert.equal((await fetch(root + path, options)).status, failure === 'timeout' ? 502 : 403);
      assert.equal((await fetch(root + path, options)).status, 429);
      assert.equal(calls, 1);
    });
  }
});

test('one authorized wallet cannot consume another wallet nonce', async () => {
  let calls = 0;
  await serve({ roleCheck: async () => true, fetcher: async () => { calls++; return Response.json({ success: true }); } }, async root => {
    const path = '/api/v1/traceability/documents';
    for (const wallet of [Wallet.createRandom(), Wallet.createRandom()]) {
      const options = await signed(root, { wallet });
      assert.equal((await fetch(root + path, options)).status, 200);
      assert.equal((await fetch(root + path, options)).status, 429);
    }
    assert.equal(calls, 2);
  });
});
