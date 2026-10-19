const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { DocumentService, cidReference, MAX_BYTES } = require('../ipfs/documents');
const { createApp } = require('../server');
const CID = 'bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const bytes = Buffer.from('%PDF-1.7\npublic synthetic fixture\n%%EOF');
const digest = createHash('sha256').update(bytes).digest('hex');
const env = { IPFS_API_TOKEN: 'a'.repeat(40), IPFS_PROVIDER: 'pinata', IPFS_PROVIDER_TOKEN: 'provider-secret', IPFS_APPROVED_SHA256: digest };
const metadata = { batchId: 'BATCH-001', documentType: 'medicine-certificate', publicApproved: 'true' };
const file = { buffer: bytes, size: bytes.length, originalname: 'public.pdf', mimetype: 'application/pdf' };
const pinResponse = () => Response.json({ IpfsHash: CID, PinSize: bytes.length + 8, Timestamp: new Date().toISOString() });
async function serve(options, run) {
  const server = createApp(options).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
function form(data = metadata, content = bytes, name = 'public.pdf', mime = 'application/pdf') {
  const result = new FormData();
  for (const [key, value] of Object.entries(data)) result.append(key, value);
  result.append('file', new Blob([content], { type: mime }), name);
  return result;
}

test('CID parser canonicalizes v0/v1 and rejects URLs, paths, queries and unsupported codecs', async () => {
  const { CID: Parser } = await import('multiformats/cid');
  const { create } = await import('multiformats/hashes/digest');
  const v0 = Parser.createV0(create(0x12, new Uint8Array(32))).toString();
  assert.equal((await cidReference(v0)).cid, Parser.parse(v0).toV1().toString());
  assert.equal((await cidReference('ipfs://' + CID)).reference, 'ipfs://' + CID);
  for (const bad of ['https://example.org/' + CID, CID + '/file', CID + '?x=1', 'ipfs://../', '', null, 'QmInvalid']) await assert.rejects(cidReference(bad), { code: 'INVALID_CID' });
  const unsupported = Parser.createV1(0x71, create(0x12, new Uint8Array(32))).toString();
  await assert.rejects(cidReference(unsupported), { code: 'INVALID_CID' });
});

test('both document types pin approved bytes; provider credentials and metadata stay server-side', async () => {
  for (const documentType of ['medicine-certificate', 'laboratory-report']) {
    let called = false;
    const service = new DocumentService(env, async (url, options) => {
      called = true; assert.equal(url.href, 'https://api.pinata.cloud/pinning/pinFileToIPFS');
      assert.equal(options.headers.Authorization, 'Bearer provider-secret');
      assert.equal(options.redirect, 'error');
      assert.equal(options.body.get('file').name, 'document.pdf');
      assert.equal(options.body.get('pinataMetadata'), null);
      return pinResponse();
    });
    const result = await service.upload(file, { ...metadata, documentType });
    assert.equal(called, true); assert.equal(result.cid, CID); assert.equal(result.sha256, digest);
    assert.ok(!JSON.stringify(result).includes('provider-secret'));
  }
});

test('invalid signatures, MIME, extensions, metadata, confidential and oversized files never reach provider', async () => {
  let calls = 0;
  const service = new DocumentService(env, async () => { calls++; return pinResponse(); });
  for (const input of [undefined, { ...file, size: MAX_BYTES + 1 }, { ...file, buffer: Buffer.alloc(0) }, { ...file, buffer: Buffer.from('<script>') }, { ...file, mimetype: 'text/html' }, { ...file, originalname: 'file.html' }]) await assert.rejects(service.upload(input, metadata));
  for (const input of [{ ...metadata, patientName: 'private' }, { ...metadata, publicApproved: 'false' }, { ...metadata, documentType: 'prescription' }, { ...metadata, batchId: '../x' }, { ...metadata, batchId: ['B'] }]) await assert.rejects(service.upload(file, input));
  await assert.rejects(new DocumentService({ ...env, IPFS_APPROVED_SHA256: '' }, async () => { calls++; }).upload(file, metadata), { code: 'DOCUMENT_NOT_APPROVED' });
  assert.equal(calls, 0);
});

test('provider errors, invalid CID, missing pin confirmation and huge responses are redacted', async () => {
  for (const reply of [
    async () => { throw new Error('provider-secret'); },
    async () => new Response('provider-secret', { status: 401 }),
    async () => Response.json({ IpfsHash: 'invalid', PinSize: 100, Timestamp: new Date().toISOString() }),
    async () => Response.json({ IpfsHash: CID }),
    async () => new Response('x'.repeat(17000)),
  ]) {
    await assert.rejects(new DocumentService(env, reply).upload(file, metadata), error => error.code === 'IPFS_UPLOAD_FAILED' && !error.message.includes('provider-secret'));
  }
});

test('PNG/JPEG uploads and administrator-configured HTTPS endpoints are supported', async () => {
  for (const [content, extension, mimetype] of [[Buffer.from('89504e470d0a1a0a00000000', 'hex'), 'png', 'image/png'], [Buffer.from('ffd8ffe000000000', 'hex'), 'jpeg', 'image/jpeg']]) {
    const local = { ...env, IPFS_PIN_ENDPOINT: 'https://pins.example/pin', IPFS_APPROVED_SHA256: createHash('sha256').update(content).digest('hex') };
    const service = new DocumentService(local, async url => {
      assert.equal(url.href, local.IPFS_PIN_ENDPOINT);
      return Response.json({ IpfsHash: CID, PinSize: 100, Timestamp: new Date().toISOString() });
    });
    assert.equal((await service.upload({ buffer: content, size: content.length, originalname: 'fixture.' + extension, mimetype }, metadata)).cid, CID);
  }
  for (const config of [{ IPFS_PIN_ENDPOINT: 'http://example.org/pin' }, { IPFS_PIN_ENDPOINT: 'https://secret@example.org/pin' }, { IPFS_PROVIDER: 'unsupported' }]) {
    await assert.rejects(new DocumentService({ ...env, ...config }, async () => { throw new Error('must not call'); }).upload(file, metadata), { code: 'IPFS_UPLOAD_FAILED' });
  }
});

test('concurrency limit prevents a third active provider upload', async () => {
  const releases = [];
  const service = { upload: () => new Promise(resolve => releases.push(() => resolve({ cid: CID }))) };
  await serve({ env, documentService: service }, async url => {
    const send = () => fetch(url + '/api/v1/traceability/documents', { method: 'POST', headers: { Authorization: 'Bearer ' + env.IPFS_API_TOKEN }, body: form() });
    const first = send(); const second = send();
    // Wait for both upload handlers without depending on provider timing.
    const deadline = Date.now() + 5000;
    while (releases.length < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    try { assert.equal(releases.length, 2); assert.equal((await send()).status, 429); }
    finally { releases.forEach(release => release()); }
    assert.equal((await first).status, 200); assert.equal((await second).status, 200);
  });
});

test('retrieval uses only configured gateway, no authorization forwarding and bounded supported bytes', async () => {
  const service = new DocumentService(env, async (url, options) => {
    assert.equal(url.href, 'https://gateway.pinata.cloud/ipfs/' + CID);
    assert.equal(options.headers, undefined); assert.equal(options.redirect, 'error');
    return new Response(bytes);
  });
  assert.deepEqual((await service.retrieve(CID)).buffer, bytes);
  for (const reply of [async () => new Response('html'), async () => new Response(bytes, { status: 302 }), async () => new Response('x'.repeat(MAX_BYTES + 1))]) {
    await assert.rejects(new DocumentService(env, reply).retrieve(CID), { code: 'IPFS_RETRIEVAL_FAILED' });
  }
  await assert.rejects(service.retrieve(CID + '/etc/passwd'), { code: 'INVALID_CID' });
});

test('HTTP auth runs before uploads; valid upload, attachment retrieval and rate limits', async () => {
  const service = new DocumentService(env, async (_url, options) => options.method === 'POST' ? pinResponse() : new Response(bytes));
  await serve({ env, documentService: service }, async url => {
    const base = url + '/api/v1/traceability/documents';
    assert.equal((await fetch(base, { method: 'POST', body: form() })).status, 401);
    const headers = { Authorization: 'Bearer ' + env.IPFS_API_TOKEN };
    const upload = await fetch(base, { method: 'POST', headers, body: form() });
    assert.equal(upload.status, 200); assert.equal((await upload.json()).data.cid, CID);
    const download = await fetch(base + '/' + CID, { headers });
    assert.equal(download.status, 200); assert.equal(download.headers.get('content-type'), 'application/octet-stream');
    assert.match(download.headers.get('content-disposition'), /^attachment/);
    assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(download.headers.get('content-security-policy').includes('sandbox'));
    await download.arrayBuffer();
    for (let i = 0; i < 18; i++) await (await fetch(base + '/invalid', { headers })).arrayBuffer();
    assert.equal((await fetch(base + '/' + CID, { headers })).status, 429);
  });
  await serve({ env: {} }, async url => assert.equal((await fetch(url + '/api/v1/traceability/documents/' + CID)).status, 503));
});

test('multipart limits reject oversized files and extra metadata without provider calls', async () => {
  let calls = 0;
  await serve({ env, documentService: { upload: async () => { calls++; } } }, async url => {
    const options = { method: 'POST', headers: { Authorization: 'Bearer ' + env.IPFS_API_TOKEN } };
    assert.equal((await fetch(url + '/api/v1/traceability/documents', { ...options, body: form(metadata, Buffer.alloc(MAX_BYTES + 1)) })).status, 413);
    assert.equal((await fetch(url + '/api/v1/traceability/documents', { ...options, body: form({ ...metadata, extra: 'x' }) })).status, 400);
  });
  assert.equal(calls, 0);
});

test('registration uses canonical CIDs in existing fields and rejects arbitrary references', async () => {
  let captured;
  const batch = { batchId: 'B', medicineId: 'M', name: 'Medicine', category: 'Category', dosageForm: 'Tablet', strength: '5 mg', manufacturerName: 'Maker', indication: 'Indication', classification: 'Prescription', quantity: 10, manufacturedAt: 100, expiresAt: 200, documentReference: CID, certificateReference: 'ipfs://' + CID };
  await serve({ client: { prepare: async (...args) => { captured = args; return { data: 'unsigned' }; } } }, async url => {
    const send = batch => fetch(url + '/api/v1/traceability/batches/transactions/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sender: '0x1111111111111111111111111111111111111111', batch }) });
    assert.equal((await send(batch)).status, 200);
    assert.equal(captured[0], 'registerBatch');
    assert.equal(captured[1][0].documentReference, 'ipfs://' + CID);
    assert.equal((await send({ ...batch, certificateReference: 'https://evil.invalid' })).status, 400);
  });
});
