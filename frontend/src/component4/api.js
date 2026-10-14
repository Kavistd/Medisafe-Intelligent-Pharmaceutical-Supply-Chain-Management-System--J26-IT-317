export const API_BASE = (import.meta.env.VITE_COMPONENT4_API_URL || "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.name = "ApiError"; this.status = status; this.code = code; }
}

export async function apiRequest(path, { token, method = "GET", body } = {}) {
  let response;
  try { response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }); } catch { throw new Error("Cannot reach the Component 4 API. Confirm the backend is running at port 5004 and the Vite proxy is available."); }

  let result;
  try { result = await response.json(); }
  catch { throw new Error("The API returned an unreadable response."); }

  if (!response.ok || result.success === false) throw new ApiError(result.message || `Request failed (${response.status}).`, response.status, result.error);
  return result;
}
