const assert = require("node:assert/strict");
const test = require("node:test");
const { formatPrescription, verifyPatientCredentialAgainstRecord } = require("../services/prescriptionService");

const activeRecord = (overrides = {}) => ({ status: 0, expiryTime: BigInt(Math.floor(Date.now() / 1000) + 300), ...overrides });

test("patient hash is accepted only for an active, unexpired scoped record", async () => {
  let checked = false;
  assert.equal(await verifyPatientCredentialAgainstRecord(activeRecord(), async () => { checked = true; return true; }), true);
  assert.equal(checked, true);
});

test("expiry equality matches the contract and expires only after the boundary second", async () => {
  const expiryTime = 1_800_000_000;
  const record = activeRecord({ expiryTime: BigInt(expiryTime) });
  assert.equal(await verifyPatientCredentialAgainstRecord(record, async () => true, expiryTime), true);
  assert.equal(formatPrescription({ ...record, issuedAt: 1_799_999_000n }, expiryTime).isExpired, false);

  await assert.rejects(
    verifyPatientCredentialAgainstRecord(record, async () => true, expiryTime + 1),
    (error) => error.statusCode === 410 && error.code === "PRESCRIPTION_EXPIRED"
  );
  assert.equal(formatPrescription({ ...record, issuedAt: 1_799_999_000n }, expiryTime + 1).isExpired, true);
});

test("incorrect patient hash is rejected without returning the stored hash", async () => {
  await assert.rejects(
    verifyPatientCredentialAgainstRecord(activeRecord(), async () => false),
    (error) => error.statusCode === 403 && error.code === "PATIENT_CREDENTIAL_MISMATCH" && !JSON.stringify(error).includes("patientHash")
  );
});

test("expired and non-active prescriptions are rejected before hash verification", async () => {
  let checked = false;
  await assert.rejects(
    verifyPatientCredentialAgainstRecord(activeRecord({ expiryTime: BigInt(Math.floor(Date.now() / 1000) - 1) }), async () => { checked = true; return true; }),
    (error) => error.statusCode === 410 && error.code === "PRESCRIPTION_EXPIRED"
  );
  await assert.rejects(
    verifyPatientCredentialAgainstRecord(activeRecord({ status: 1 }), async () => { checked = true; return true; }),
    (error) => error.statusCode === 409 && error.code === "PRESCRIPTION_NOT_ACTIVE"
  );
  assert.equal(checked, false);
});
