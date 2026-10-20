const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MARKER, RPC, readConfig, fixtures, assertLocalSettings } = require('./common');
const { mockService } = require('./start-backend');
test('mock launcher refuses real providers, disabled mock mode and provider credentials', () => {
  for (const env of [{}, { IPFS_MOCK_ONLY: 'true', IPFS_PROVIDER: 'pinata' }, { IPFS_MOCK_ONLY: 'true', IPFS_PROVIDER: 'mock', IPFS_PROVIDER_TOKEN: 'synthetic-invalid-token' }]) assert.throws(() => mockService(env));
});
test('both synthetic PDFs pass existing approval validation and return matching fixture CIDs', async () => {
  const docs = fixtures(); const env = { IPFS_MOCK_ONLY: 'true', IPFS_PROVIDER: 'mock', IPFS_APPROVED_SHA256: docs.map(doc => doc.sha256).join(',') };
  const service = mockService(env);
  for (const [index, doc] of docs.entries()) {
    assert.ok(doc.bytes.toString().includes('xref\n')); assert.ok(doc.bytes.toString().includes('NO PATIENT DATA'));
    const result = await service.upload({ buffer: doc.bytes, size: doc.bytes.length, originalname: doc.name, mimetype: 'application/pdf' }, { batchId: 'SYNTHETIC', documentType: index ? 'laboratory-report' : 'medicine-certificate', publicApproved: 'true' });
    assert.equal(result.cid, doc.cid); assert.deepEqual((await service.retrieve(doc.cid)).buffer, doc.bytes);
    assert.ok(!JSON.stringify(result).includes('phase7-mock-only-no-network'));
  }
  const bad = Buffer.from('%PDF-1.4\nNot an approved fixture');
  await assert.rejects(service.upload({ buffer: bad, size: bad.length, originalname: 'invalid.pdf', mimetype: 'application/pdf' }, { batchId: 'SYNTHETIC', documentType: 'medicine-certificate', publicApproved: 'true' }), { code: 'DOCUMENT_NOT_APPROVED' });
});
test('configuration reader refuses unmanaged files and preserves values after equals signs', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'component1-local-test-')), file = path.join(folder, 'config');
  try {
    fs.writeFileSync(file, 'KEY=unmanaged'); assert.throws(() => readConfig(file));
    fs.writeFileSync(file, MARKER + '\nKEY=synthetic=value\n'); assert.equal(readConfig(file).KEY, 'synthetic=value');
  } finally { fs.unlinkSync(file); fs.rmdirSync(folder); }
});
test('managed launch settings reject external RPCs, real providers and public token variables', () => {
  const token = 'synthetic-test-token-'.repeat(2), address = '0x1111111111111111111111111111111111111111';
  const backend = { IPFS_API_TOKEN: token, MEDICINE_TRACEABILITY_ADDRESS: address, WEB3_RPC_URL: RPC, TRACEABILITY_NETWORK: 'localhost', HOST: '127.0.0.1', PORT: '5001', IPFS_MOCK_ONLY: 'true', IPFS_PROVIDER: 'mock' };
  const frontend = { IPFS_API_TOKEN: token, VITE_TRACEABILITY_ADDRESS: address, TRACEABILITY_RPC_URL: RPC, VITE_TRACEABILITY_START_BLOCK: '1' };
  assertLocalSettings(backend, 'backend'); assertLocalSettings(frontend, 'frontend');
  for (const patch of [{ WEB3_RPC_URL: 'https://example.invalid' }, { TRACEABILITY_NETWORK: 'sepolia' }, { HOST: '0.0.0.0' }, { IPFS_PROVIDER: 'pinata' }, { IPFS_PROVIDER_TOKEN: 'synthetic-invalid-provider-token' }]) assert.throws(() => assertLocalSettings({ ...backend, ...patch }, 'backend'));
  assert.throws(() => assertLocalSettings({ ...frontend, TRACEABILITY_RPC_URL: 'https://example.invalid' }, 'frontend'));
  assert.throws(() => assertLocalSettings({ ...frontend, VITE_IPFS_API_TOKEN: token }, 'frontend'));
});
