import { apiRequest } from "./api.js";

const PRESCRIPTION_ID = /^0x[0-9a-fA-F]{64}$/;

/** Read the authenticated doctor's list without sending an address in the request. */
export async function fetchDoctorPrescriptions(token) {
  const result = await apiRequest("/api/v1/prescriptions/mine", { token });
  const ids = result?.data?.prescriptionIds;
  const count = result?.data?.count;
  if (
    !Array.isArray(ids) ||
    !ids.every((id) => typeof id === "string" && PRESCRIPTION_ID.test(id)) ||
    !Number.isInteger(count) ||
    count < 0 ||
    count !== ids.length
  ) {
    throw new Error("The API returned an invalid prescription list.");
  }

  // Keep the dashboard's data limited to identifiers and count even if the API
  // response is extended later with other registry fields.
  return { prescriptionIds: ids, count };
}
