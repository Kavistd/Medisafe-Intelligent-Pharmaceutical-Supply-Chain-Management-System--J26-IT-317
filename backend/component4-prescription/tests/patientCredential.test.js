const assert = require("node:assert/strict");
const test = require("node:test");
const { verifyPatientCredentialAgainstRecord } = require("../services/prescriptionService");

const activeRecord = (overrides = {}) => ({ status: 0, expiryTime: BigInt(Math.floor(Date.now() / 1000) + 300), ...overrides });

test("patient hash is accepted only for an active, unexpired scoped record", async () => {
  let checked = false;
  assert.equal(await verifyPatientCredentialAgainstRecord(activeRecord(), async () => { checked = true; return true; }), true);
  assert.equal(checked, true);
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
