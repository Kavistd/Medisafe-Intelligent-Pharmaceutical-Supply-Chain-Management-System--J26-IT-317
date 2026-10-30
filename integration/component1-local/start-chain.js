const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { ROOT, checkChain } = require('./common');
async function main() {
  const occupied = await new Promise(resolve => { const socket = net.connect(8545, '127.0.0.1'); socket.once('connect', () => { socket.destroy(); resolve(true); }); socket.once('error', () => resolve(false)); socket.setTimeout(1000, () => { socket.destroy(); resolve(true); }); });
  if (occupied) throw new Error('Port 8545 is occupied. Reuse a verified node or stop it yourself; this launcher never resets an existing chain.');
  const env = { ...process.env, HARDHAT_CONFIG: path.join(ROOT, 'blockchain/hardhat.config.js'), HARDHAT_NETWORK: 'hardhat' };
  for (const key of ['PRIVATE_KEY', 'RPC_URL', 'WEB3_RPC_URL', 'IPFS_PROVIDER_TOKEN', 'IPFS_API_TOKEN', 'NODE_OPTIONS']) delete env[key];
  // Hardhat prints development private keys by default. Discard both streams;
  // never persist them to log files or forward them to the parent console.
  const child = spawn(process.execPath, [path.join(ROOT, 'blockchain/node_modules/hardhat/internal/cli/cli.js'), 'node', '--hostname', '127.0.0.1', '--port', '8545'], { cwd: path.join(ROOT, 'blockchain'), env, stdio: 'ignore', windowsHide: true });
  let stopped = false;
  child.on('error', () => { stopped = true; console.error('Local Hardhat process could not start.'); process.exitCode = 1; });
  child.on('exit', code => { stopped = true; if (code && !process.exitCode) { console.error('Local Hardhat process stopped unsuccessfully. Check dependencies and compiler permissions.'); process.exitCode = 1; } });
  const stop = () => child.kill(); process.once('SIGINT', stop); process.once('SIGTERM', stop); process.once('exit', stop);
  console.log('Starting loopback-only Hardhat; account/key output suppressed.');
  for (let attempt = 0; attempt < 60 && !stopped; attempt++) {
    try { await checkChain(); console.log('Hardhat ready: http://127.0.0.1:8545, chain 31337. Keep this terminal open.'); return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  child.kill(); throw new Error('Local node readiness check failed.');
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
