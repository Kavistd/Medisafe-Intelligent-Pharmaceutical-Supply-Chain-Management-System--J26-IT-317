import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "./api.js";
import { fetchDoctorPrescriptions } from "./doctorPrescriptions.js";

const token = "test-doctor-session-token";
const prescriptionId = `0x${"a".repeat(64)}`;

test("doctor prescription loader uses the authenticated token without sending an address", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({
      success: true,
      data: { doctorAddress: "0x0000000000000000000000000000000000000001", prescriptionIds: [prescriptionId], count: 1, patientHash: "must-not-be-exposed" },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await fetchDoctorPrescriptions(token);
    assert.equal(request.url, "/api/v1/prescriptions/mine");
    assert.equal(request.options.method, "GET");
    assert.equal(request.options.headers.Authorization, `Bearer ${token}`);
    assert.equal(Object.hasOwn(request.options, "body"), false);
    assert.deepEqual(result, { prescriptionIds: [prescriptionId], count: 1 });
    assert.equal(Object.hasOwn(result, "patientHash"), false);
  } finally { globalThis.fetch = originalFetch; }
});

test("doctor prescription loader accepts an empty list", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true, data: { prescriptionIds: [], count: 0 } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  try {
    assert.deepEqual(await fetchDoctorPrescriptions(token), { prescriptionIds: [], count: 0 });
  } finally { globalThis.fetch = originalFetch; }
});

test("doctor prescription loader preserves an authentication expiry response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ success: false, error: "UNAUTHORIZED", message: "Authentication required." }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
  try {
    await assert.rejects(fetchDoctorPrescriptions(token), (error) => error instanceof ApiError && error.status === 401 && error.code === "UNAUTHORIZED");
  } finally { globalThis.fetch = originalFetch; }
});

test("doctor prescription loader rejects malformed list data without exposing extra fields", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    success: true,
    data: { prescriptionIds: ["invalid"], count: 1, credential: "private-marker" },
  }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    await assert.rejects(fetchDoctorPrescriptions(token), (error) => {
      assert.equal(error.message, "The API returned an invalid prescription list.");
      assert.equal(error.message.includes("private-marker"), false);
      return true;
    });
  } finally { globalThis.fetch = originalFetch; }
});
