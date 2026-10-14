import assert from "node:assert/strict";
import test from "node:test";
import { assertTokenRole, buildChallengeRequest } from "./authFlow.js";

const prescriptionId = `0x${"b".repeat(64)}`;

test("professional challenges do not request a patient-scoped session", () => {
  assert.deepEqual(buildChallengeRequest("doctor", "0x0000000000000000000000000000000000000001"), {
    address: "0x0000000000000000000000000000000000000001",
  });
});

test("patient challenge requires and normalizes a prescription ID", () => {
  const address = "0x0000000000000000000000000000000000000002";
  assert.throws(() => buildChallengeRequest("patient", address), /prescription ID/);
  assert.deepEqual(buildChallengeRequest("patient", address, prescriptionId.toUpperCase().replace("0X", "0x")), {
    address,
    patient: true,
    prescriptionId,
  });
});

test("patient tokens must carry the patient role and professional roles remain distinct", () => {
  assert.doesNotThrow(() => assertTokenRole({ roles: ["patient"], prescriptionId }, "patient", prescriptionId));
  assert.throws(() => assertTokenRole({ roles: ["patient"], prescriptionId }, "patient", `0x${"c".repeat(64)}`), /not scoped/);
  assert.throws(() => assertTokenRole({ roles: ["doctor"] }, "patient"), /patient-scoped/);
  assert.throws(() => assertTokenRole({ roles: ["patient"] }, "doctor"), /no on-chain doctor role/);
});
