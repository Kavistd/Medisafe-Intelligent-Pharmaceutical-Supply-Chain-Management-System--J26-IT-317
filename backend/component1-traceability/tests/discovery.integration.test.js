const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('isolated contract → discovery API keeps a batch after both confirmed transfers', async () => {
  // Never connect to localhost:8545 or Sepolia. This process owns a disposable EVM.
  process.env.HARDHAT_NETWORK = 'hardhat';
  process.env.HARDHAT_CONFIG = path.resolve(__dirname, '../../../blockchain/hardhat.config.js');
  const hre = require('../../../blockchain/node_modules/hardhat');
  assert.equal(hre.network.name, 'hardhat');
  const { TraceabilityClient } = require('../blockchain/client');
  const { createApp } = require('../server');
  const [admin, manufacturer, distributor, pharmacy] = await hre.ethers.getSigners();
  const contract = await hre.ethers.deployContract('MedicineTraceability', [admin.address]);
  await contract.waitForDeployment();
  for (const [role, signer] of [['MANUFACTURER_ROLE', manufacturer], ['DISTRIBUTOR_ROLE', distributor], ['PHARMACY_ROLE', pharmacy]]) {
    await (await contract.grantRole(await contract[role](), signer.address)).wait();
  }
  const now = (await hre.ethers.provider.getBlock('latest')).timestamp;
  const batchId = 'SYNTHETIC-QR-INTEGRATION';
  const data = { batchId, medicineId: 'TEST-M', name: 'Synthetic medicine', category: 'Synthetic', dosageForm: 'Tablet', strength: '1 mg', manufacturerName: 'Synthetic manufacturer', indication: 'Test only', classification: 'Synthetic', quantity: 10, manufacturedAt: now - 100, expiresAt: now + 10000, documentReference: 'ipfs://synthetic-test-reference', certificateReference: 'ipfs://synthetic-test-reference' };
  await (await contract.connect(manufacturer).registerBatch(data)).wait();
  await (await contract.connect(manufacturer).initiateTransfer(batchId, distributor.address)).wait();
  await (await contract.connect(distributor).confirmTransfer(batchId, 1)).wait();
  await (await contract.connect(distributor).initiateTransfer(batchId, pharmacy.address)).wait();
  await (await contract.connect(pharmacy).confirmTransfer(batchId, 2)).wait();
  const client = new TraceabilityClient({ rpcUrl: 'http://unused', chainId: 31337, address: await contract.getAddress(), startBlock: 0 }, hre.ethers.provider);
  const server = createApp({ client }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1/traceability`;
  const get = async suffix => { const response = await fetch(base + suffix); assert.equal(response.status, 200); return (await response.json()).data; };
  try {
    const discovered = await get('/batches');
    assert.ok(discovered.ids.includes(batchId)); assert.equal(discovered.complete, true);
    const newest = await get('/batches?direction=backward');
    assert.ok(newest.ids.includes(batchId)); assert.equal(newest.complete, true);
    const batch = (await get('/batches/' + batchId))['0'];
    assert.equal(batch.owner, pharmacy.address); assert.equal(batch.stage, '2');
    assert.equal((await get('/batches/' + batchId + '/history'))['0'].length, 2);
    assert.equal((await get('/batches/' + batchId + '/pending-transfer'))['0'].id, '0');
    assert.equal((await get('/network')).chainId, 31337);
    assert.equal((await get('/batches/' + batchId + '/status')).expired, false);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
