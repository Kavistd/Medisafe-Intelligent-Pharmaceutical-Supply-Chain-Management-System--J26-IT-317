const DEFAULT_BASE = "/component2";

export const COMPONENT2_API_BASE = import.meta.env?.VITE_COMPONENT2_API_URL || DEFAULT_BASE;

async function parseResponse(response) {
  let body;
  try { body = await response.json(); }
  catch {
    if (!response.ok) throw new Error(`Component 2 service is unavailable (${response.status}).`);
    throw new Error("Component 2 returned an unreadable response.");
  }
  if (!response.ok) {
    const detail = typeof body?.detail === "string" ? body.detail : body?.message;
    throw new Error(detail || `Component 2 request failed (${response.status}).`);
  }
  return body;
}

export async function component2Request(path, options = {}, fetchImpl = fetch) {
  let response;
  try {
    const requestFetch = options.fetchImpl || fetchImpl;
    response = await requestFetch(`${COMPONENT2_API_BASE}${path}`, {
      method: options.method || "GET",
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch {
    throw new Error("Component 2 API is unavailable. Start the risk-scoring backend and try again.");
  }
  return parseResponse(response);
}

export function assessMedicine(medicine, options) {
  return component2Request("/api/v1/risk/assess", { method: "POST", body: medicine, ...options });
}

export function assessRegisteredBatch(batchId, options) {
  const encoded = encodeURIComponent(batchId.trim());
  return component2Request(`/api/v1/risk/assess/batch/${encoded}`, { method: "POST", ...options });
}

export function buildMedicineRiskTransaction(medicine, sender, options) {
  return component2Request("/api/v1/risk/assess/transaction", {
    method: "POST",
    body: { ...medicine, sender },
    ...options,
  });
}

export function buildBatchRiskTransaction(batchId, sender, options) {
  const encoded = encodeURIComponent(batchId.trim());
  return component2Request(`/api/v1/risk/assess/batch/${encoded}/transaction`, {
    method: "POST",
    body: { sender },
    ...options,
  });
}

export function confirmPublishedRisk(transactionHash, batchId, riskScore, options) {
  return component2Request("/api/v1/risk/publish/confirm", {
    method: "POST",
    body: { transaction_hash: transactionHash, batch_id: batchId, risk_score: riskScore },
    ...options,
  });
}

export async function fetchReadiness(options) {
  const [api, blockchain] = await Promise.allSettled([
    component2Request("/health", options),
    component2Request("/health/blockchain", options),
  ]);
  return {
    api: api.status === "fulfilled" ? api.value : null,
    blockchain: blockchain.status === "fulfilled" ? blockchain.value : null,
    apiError: api.status === "rejected" ? api.reason.message : "",
    blockchainError: blockchain.status === "rejected" ? blockchain.reason.message : "",
  };
}
