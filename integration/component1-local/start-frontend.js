const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ROOT, readConfig, checkChain, assertLocalSettings } = require('./common');
async function main() {
  const env = readConfig(path.join(ROOT, 'frontend/.env.local')); await checkChain();
  assertLocalSettings(env, 'frontend');
  Object.assign(process.env, env);
  process.chdir(path.join(ROOT, 'frontend'));
  const { createServer } = await import(pathToFileURL(path.join(ROOT, 'frontend/node_modules/vite/dist/node/index.js')));
  const server = await createServer({ root: process.cwd(), configFile: path.join(ROOT, 'frontend/vite.config.js'), server: { host: '127.0.0.1', port: 5173, strictPort: true } });
  await server.listen();
  console.log('Component 1: http://127.0.0.1:5173/traceability.html'); console.log('Existing Component 4 page: http://127.0.0.1:5173/ (its backend/deployments are not started).');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
}
if (require.main === module) main().catch(() => { console.error('Frontend startup failed. Check local setup, installed frontend dependencies and port 5173.'); process.exitCode = 1; });
