import assert from "node:assert/strict";
import test from "node:test";
import {
  assessMedicine,
  assessRegisteredBatch,
  buildBatchRiskTransaction,
  buildMedicineRiskTransaction,
  component2Request,
  confirmPublishedRisk,
  fetchReadiness,
} from "./api.js";

function response(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

test("manual assessment sends the medicine contract to Component 2", async () => {
  const payload = { batch_id: "BATCH-001", Name: "Amoxicillin" };
  const calls = [];
  const result = await assessMedicine(payload, {
    fetchImpl: async (...args) => { calls.push(args); return response({ risk_score: 0.2 }); },
  });
  assert.equal(result.risk_score, 0.2);
  assert.equal(calls[0][0], "/component2/api/v1/risk/assess");
  assert.deepEqual(JSON.parse(calls[0][1].body), payload);
});

test("registered batch IDs are encoded before assessment", async () => {
  let requestedUrl = "";
  await assessRegisteredBatch(" DEMO/BATCH 1 ", {
    fetchImpl: async (url) => { requestedUrl = url; return response({ risk_level: "Low" }); },
  });
  assert.equal(requestedUrl, "/component2/api/v1/risk/assess/batch/DEMO%2FBATCH%201");
});

test("API errors expose safe backend details", async () => {
  await assert.rejects(
    component2Request("/api/v1/risk/assess", { fetchImpl: async () => response({ detail: "Invalid category" }, false, 400) }),
    /Invalid category/,
  );
});

test("readiness keeps API and blockchain failures independent", async () => {
  const result = await fetchReadiness({
    fetchImpl: async (url) => url.endsWith("/health")
      ? response({ status: "ok" })
      : response({ detail: "Registry unavailable" }, false, 503),
  });
  assert.equal(result.api.status, "ok");
  assert.equal(result.blockchain, null);
  assert.match(result.blockchainError, /Registry unavailable/);
});

test("manual blockchain preparation sends flattened medicine fields and wallet", async () => {
  const calls = [];
  await buildMedicineRiskTransaction(
    { batch_id: "BATCH-001", Name: "Amoxicillin" },
    "0x1111111111111111111111111111111111111111",
    { fetchImpl: async (...args) => { calls.push(args); return response({ transaction: {} }); } },
  );
  assert.equal(calls[0][0], "/component2/api/v1/risk/assess/transaction");
  assert.deepEqual(JSON.parse(calls[0][1].body), {
    batch_id: "BATCH-001",
    Name: "Amoxicillin",
    sender: "0x1111111111111111111111111111111111111111",
  });
});

test("registered batch preparation and confirmation use exact API contracts", async () => {
  const urls = [];
  const fetchImpl = async (url) => { urls.push(url); return response({ confirmed: true }); };
  await buildBatchRiskTransaction("BATCH/001", "0x1111111111111111111111111111111111111111", { fetchImpl });
  await confirmPublishedRisk(`0x${"a".repeat(64)}`, "BATCH/001", 0.24, { fetchImpl });
  assert.deepEqual(urls, [
    "/component2/api/v1/risk/assess/batch/BATCH%2F001/transaction",
    "/component2/api/v1/risk/publish/confirm",
  ]);
});
