const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { evaluate } = require('./run');
const { CentralizedPrescriptionDatabase } = require('./centralized-baseline');
const { benchmarkClientCrypto, canonicalIdentity, generatePatientSalt, hashPatientCredential } = require('./client-crypto-benchmark');

test('Component 4: client-side hashing is deterministic and salt-dependent', () => {
  const identity = { nationalId: '123456789V', fullName: 'John Doe', dateOfBirth: '1985-06-15' };
  const salt1 = generatePatientSalt();
  const salt2 = generatePatientSalt();

  const hash1 = hashPatientCredential(identity, salt1);
  const hash1Again = hashPatientCredential(identity, salt1);
  const hash2 = hashPatientCredential(identity, salt2);

  assert.equal(hash1, hash1Again);
  assert.notEqual(hash1, hash2);
  assert.match(hash1, /^0x[a-f0-9]{64}$/);
});

test('Component 4: centralized baseline enforces single-use and validates doctor permissions', () => {
  const db = new CentralizedPrescriptionDatabase();
  const doc = '0x1111111111111111111111111111111111111111';
  const pharm = '0x2222222222222222222222222222222222222222';
  db.registerDoctor(doc);
  db.registerPharmacy(pharm);

  const rxId = 'RX-TEST-001';
  const patientHash = '0x' + 'a'.repeat(64);
  const now = Math.floor(Date.now() / 1000);

  // Unauthorized doctor issuance fails
  assert.throws(() => {
    db.issuePrescription({ doctorId: '0x3333333333333333333333333333333333333333', prescriptionId: rxId, patientHash, medicineId: 'MED', batchId: 'B1', expiryTime: now + 3600 });
  }, /UnauthorizedDoctor/);

  // Valid issue succeeds
  const { record } = db.issuePrescription({ doctorId: doc, prescriptionId: rxId, patientHash, medicineId: 'MED', batchId: 'B1', expiryTime: now + 3600 });
  assert.equal(record.status, 'ACTIVE');

  // Valid dispense succeeds
  const { record: dispensed } = db.dispensePrescription({ pharmacyId: pharm, prescriptionId: rxId, patientHash, externalRiskScore: 20, externalTrustScore: 90 });
  assert.equal(dispensed.status, 'USED');

  // Double dispense fails
  assert.throws(() => {
    db.dispensePrescription({ pharmacyId: pharm, prescriptionId: rxId, patientHash });
  }, /PrescriptionAlreadyUsed/);
});

test('Component 4: client-side cryptographic benchmark executes and returns valid metrics', async () => {
  const measurements = await benchmarkClientCrypto(2);
  assert.equal(measurements.canonicalizeAndHashMs.length, 2);
  assert.equal(measurements.encryptionWithKdfMs.length, 2);
  assert.equal(measurements.decryptionWithKdfMs.length, 2);
  assert.ok(measurements.canonicalizeAndHashMs[0] > 0);
  assert.ok(measurements.encryptionWithKdfMs[0] > 0);
});

test('Component 4: end-to-end evaluation runner executes and achieves 100% rule conformance', async () => {
  const outDir = path.join(__dirname, 'results/temp-test');
  const summary = await evaluate({ samples: 2, outDir });
  assert.equal(summary.rules.all.accuracy, 1.0);
  assert.equal(summary.rules.denied.accuracy, 1.0);
  assert.ok(summary.operations.issuePrescription.gasUsed.mean > 0);
  assert.ok(summary.operations.verifyAndDispenseWithPatientHash.gasUsed.mean > 0);
});
