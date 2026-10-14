const PRESCRIPTION_ID = /^0x[0-9a-fA-F]{64}$/;

export function buildChallengeRequest(role, address, prescriptionId = "") {
  if (role === "doctor" || role === "pharmacy") return { address };
  if (role === "patient") {
    const normalizedId = prescriptionId.trim();
    if (!PRESCRIPTION_ID.test(normalizedId)) {
      throw new Error("Enter the 32-byte prescription ID before requesting patient verification access.");
    }
    return { address, patient: true, prescriptionId: normalizedId.toLowerCase() };
  }
  throw new Error("Choose a supported Component 4 session role.");
}

export function assertTokenRole(claims, role, prescriptionId = null) {
  if (!Array.isArray(claims?.roles) || !claims.roles.includes(role)) {
    throw new Error(role === "patient"
      ? "The patient-scoped verification session could not be confirmed. Request a new challenge."
      : `This wallet has no on-chain ${role} role in the configured Component 4 contract.`);
  }
  if (role === "patient" && (typeof claims.prescriptionId !== "string" || !prescriptionId || claims.prescriptionId.toLowerCase() !== prescriptionId.toLowerCase())) {
    throw new Error("The patient session is not scoped to the requested prescription. Request a new challenge.");
  }
}
