const path = require('node:path');
const { ROOT, readConfig, checkChain, fixtures, assertLocalSettings } = require('./common');
const { createApp } = require('../../backend/component1-traceability/server');
const { DocumentService } = require('../../backend/component1-traceability/ipfs/documents');
function mockService(env) {
  if (env.IPFS_MOCK_ONLY !== 'true' || env.IPFS_PROVIDER !== 'mock' || env.IPFS_PROVIDER_TOKEN) throw new Error('Refusing non-mock IPFS configuration.');
  const docs = fixtures(), contents = new Map(docs.map(file => [file.cid, file]));
  return new DocumentService({ ...env, IPFS_PROVIDER: 'pinata', IPFS_PROVIDER_TOKEN: 'phase7-mock-only-no-network' }, async (url, request) => {
    if (request.method === 'POST') {
      const bytes = Buffer.from(await request.body.get('file').arrayBuffer());
      const document = docs.find(file => file.bytes.equals(bytes));
      if (!document) return Response.json({ error: 'Synthetic fixture required' }, { status: 403 });
      return Response.json({ IpfsHash: document.cid, PinSize: bytes.length, Timestamp: new Date().toISOString() });
    }
    const document = contents.get(new URL(url).pathname.split('/').at(-1));
    return document ? new Response(document.bytes) : new Response('', { status: 404 });
  });
}
async function main() {
  const env = readConfig(path.join(ROOT, 'backend/component1-traceability/.env'));
  assertLocalSettings(env, 'backend');
  await checkChain();
  const app = createApp({ env, documentService: mockService(env) });
  const server = app.listen(5001, '127.0.0.1', () => console.log('Component 1 backend: http://127.0.0.1:5001 (synthetic mock IPFS only).'));
  server.on('error', () => { console.error('Cannot bind Component 1 backend port 5001.'); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
}
if (require.main === module) main().catch(() => { console.error('Mock backend startup failed. Run local setup and check the local node.'); process.exitCode = 1; });
module.exports = { mockService };
