const assert = require("node:assert/strict");
const test = require("node:test");
const { formatPrescription, verifyPatientHashAgainstRecord } = require("../services/prescriptionService");

const activeRecord = (overrides = {}) => ({ status: 0, expiryTime: BigInt(Math.floor(Date.now() / 1000) + 300), ...overrides });

test("patient hash is accepted only for an active, unexpired scoped record", async () => {
  let checked = false;
  assert.equal(await verifyPatientHashAgainstRecord(activeRecord(), async () => { checked = true; return true; }), true);
  assert.equal(checked, true);
});

test("expiry uses the effective status returned by V1 at the chain timestamp", async () => {
  const expiryTime = 1_800_000_000n;
  const activeAtBoundary = activeRecord({ expiryTime });
  assert.equal(await verifyPatientHashAgainstRecord(activeAtBoundary, async () => true), true);
  assert.equal(formatPrescription({ ...activeAtBoundary, issuedAt: 1_799_999_000n }).isExpired, false);

  const expiredByChain = { ...activeAtBoundary, status: 2 };
  await assert.rejects(
    verifyPatientHashAgainstRecord(expiredByChain, async () => { throw new Error("hash check must not run"); }),
    (error) => error.statusCode === 410 && error.code === "PRESCRIPTION_EXPIRED"
  );
  assert.equal(formatPrescription({ ...expiredByChain, issuedAt: 1_799_999_000n }).isExpired, true);
});

test("incorrect patient hash is rejected without returning the stored hash", async () => {
  await assert.rejects(
    verifyPatientHashAgainstRecord(activeRecord(), async () => false),
    (error) => error.statusCode === 403 && error.code === "PATIENT_HASH_MISMATCH" && !JSON.stringify(error).includes("patientHash")
  );
});

test("expired and non-active prescriptions are rejected before hash verification", async () => {
  let checked = false;
  await assert.rejects(
    verifyPatientHashAgainstRecord(activeRecord({ status: 2 }), async () => { checked = true; return true; }),
    (error) => error.statusCode === 410 && error.code === "PRESCRIPTION_EXPIRED"
  );
  await assert.rejects(
    verifyPatientHashAgainstRecord(activeRecord({ status: 1 }), async () => { checked = true; return true; }),
    (error) => error.statusCode === 409 && error.code === "PRESCRIPTION_NOT_ACTIVE"
  );
  assert.equal(checked, false);
});
