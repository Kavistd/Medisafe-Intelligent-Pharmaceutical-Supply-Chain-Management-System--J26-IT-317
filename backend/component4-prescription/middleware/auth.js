const { ethers } = require("ethers");
const crypto = require("crypto");
const prescriptionService = require("../services/prescriptionService");

const TOKEN_TTL_SECONDS = 5 * 60;
const MAX_CHALLENGE_AGE_SECONDS = 5 * 60;
const issuedChallenges = new Map();

function unauthorized(res, message = "Authentication required.") {
  return res.status(401).json({ success: false, error: "UNAUTHORIZED", message });
}

function createChallenge(req, res) {
  if (!hasValidSecret()) return configurationError(res, "Authentication is unavailable: AUTH_TOKEN_SECRET must contain at least 32 characters.");
  const address = req.body && req.body.address;
  if (!ethers.isAddress(address || "")) {
    return res.status(400).json({ success: false, error: "VALIDATION_ERROR", message: "A valid Ethereum address is required." });
  }
  const normalized = ethers.getAddress(address);
  const issuedAt = Math.floor(Date.now() / 1000);
  const nonce = ethers.hexlify(ethers.randomBytes(16));
  for (const [issuedNonce, challenge] of issuedChallenges) {
    if (issuedAt - challenge.issuedAt > MAX_CHALLENGE_AGE_SECONDS) issuedChallenges.delete(issuedNonce);
  }
  const patient = req.body.patient === true;
  const prescriptionId = req.body.prescriptionId || null;
  if (patient && !prescriptionId) return res.status(400).json({ success: false, error: "VALIDATION_ERROR", message: "Patient verification requires a prescription ID." });
  if (!patient && prescriptionId) return res.status(400).json({ success: false, error: "VALIDATION_ERROR", message: "Prescription-scoped challenges are reserved for patient verification." });
  if (prescriptionId && !/^0x[0-9a-fA-F]{64}$/.test(prescriptionId)) {
    return res.status(400).json({ success: false, error: "VALIDATION_ERROR", message: "prescriptionId must be a bytes32 value." });
  }
  const message = [
    "MEDISAFE CHAIN Component 4 authentication",
    `Address: ${normalized}`,
    `Nonce: ${nonce}`,
    ...(patient ? ["Purpose: patient-verification"] : []),
    ...(prescriptionId ? [`Prescription: ${prescriptionId.toLowerCase()}`] : []),
    `Issued At: ${issuedAt}`,
  ].join("\n");
  issuedChallenges.set(nonce, { address: normalized, issuedAt, patient, prescriptionId: prescriptionId?.toLowerCase() || null });
  return res.json({ success: true, data: { message, nonce, expiresAt: issuedAt + MAX_CHALLENGE_AGE_SECONDS } });
}

async function exchangeSignature(req, res) {
  if (!hasValidSecret()) return configurationError(res, "Authentication is unavailable: AUTH_TOKEN_SECRET must contain at least 32 characters.");
  const { message, signature } = req.body || {};
  if (typeof message !== "string" || typeof signature !== "string") {
    return res.status(400).json({ success: false, error: "VALIDATION_ERROR", message: "message and signature are required." });
  }
  try {
    const lines = message.split("\n");
    const nonce = lines.find((line) => line.startsWith("Nonce: "))?.slice(7);
    const challenge = issuedChallenges.get(nonce);
    if (!challenge) return unauthorized(res, "Authentication challenge is invalid, expired, or already used.");
    if (Math.floor(Date.now() / 1000) - challenge.issuedAt > MAX_CHALLENGE_AGE_SECONDS) {
      issuedChallenges.delete(nonce);
      return unauthorized(res, "Authentication challenge has expired. Request a new challenge.");
    }
    if (message !== [
      "MEDISAFE CHAIN Component 4 authentication",
      `Address: ${challenge.address}`,
      `Nonce: ${nonce}`,
      ...(challenge.patient ? ["Purpose: patient-verification"] : []),
      ...(challenge.prescriptionId ? [`Prescription: ${challenge.prescriptionId}`] : []),
      `Issued At: ${challenge.issuedAt}`,
    ].join("\n")) return unauthorized(res, "Authentication challenge is invalid.");
    issuedChallenges.delete(nonce);
    const address = ethers.verifyMessage(message, signature);
    if (ethers.getAddress(address).toLowerCase() !== challenge.address.toLowerCase()) return unauthorized(res, "Signature does not match the challenge address.");
    let isDoctor = false;
    let isPharmacy = false;
    if (!challenge.patient) {
      let contract;
      try { contract = prescriptionService.getContract(true); }
      catch (error) { return configurationError(res, safeConfigurationMessage(error)); }
      const doctorRole = await contract.DOCTOR_ROLE();
      const pharmacyRole = await contract.PHARMACY_ROLE();
      isDoctor = await contract.hasRole(doctorRole, address);
      isPharmacy = await contract.hasRole(pharmacyRole, address);
    }
    if (!isDoctor && !isPharmacy && !challenge.patient) return res.status(403).json({ success: false, error: "FORBIDDEN", message: "Wallet has no Component 4 role." });
    const now = Math.floor(Date.now() / 1000);
    const roles = [ ...(isDoctor ? ["doctor"] : []), ...(isPharmacy ? ["pharmacy"] : []), ...(challenge.patient ? ["patient"] : []) ];
    const payload = Buffer.from(JSON.stringify({ sub: ethers.getAddress(address), roles, prescriptionId: challenge.prescriptionId, iat: now, exp: now + TOKEN_TTL_SECONDS })).toString("base64url");
    const token = `${payload}.${signPayload(payload)}`;
    return res.json({ success: true, data: { token, tokenType: "Bearer", expiresIn: TOKEN_TTL_SECONDS } });
  } catch (error) {
    if (error.code === "INVALID_ARGUMENT" || error.code === "BAD_DATA") return unauthorized(res, "Wallet signature is invalid or malformed.");
    if (error.code === "NETWORK_ERROR" || error.code === "SERVER_ERROR" || error.code === "TIMEOUT") return configurationError(res, "Blockchain node is unavailable. Check RPC_URL and confirm the node is running.");
    if (error.message?.includes("AUTH_TOKEN_SECRET")) return configurationError(res, "Authentication is unavailable: AUTH_TOKEN_SECRET must contain at least 32 characters.");
    if (error.message?.includes("contract address") || error.message?.includes("contract addresses")) return configurationError(res, "PrescriptionRegistry is not configured for this network.");
    return configurationError(res, "Could not verify wallet role against the Component 4 contract.");
  }
}

function hasValidSecret() { return typeof process.env.AUTH_TOKEN_SECRET === "string" && process.env.AUTH_TOKEN_SECRET.length >= 32; }

function configurationError(res, message) { return res.status(503).json({ success: false, error: "AUTH_CONFIGURATION_ERROR", message }); }

function safeConfigurationMessage(error) {
  if (/contract address|contract addresses|not configured/i.test(error.message || "")) return "PrescriptionRegistry is not configured for this network. Check NETWORK and the Component 4 contract address.";
  return "Blockchain authentication is unavailable. Check RPC_URL and confirm the Component 4 contract is deployed.";
}

function signPayload(payload) {
  if (!hasValidSecret()) {
    throw new Error("AUTH_TOKEN_SECRET must contain at least 32 characters.");
  }
  return crypto.createHmac("sha256", process.env.AUTH_TOKEN_SECRET).update(payload).digest("base64url");
}

function authenticate(req, res, next) {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return unauthorized(res);
  try {
    if (!hasValidSecret()) return configurationError(res, "Authentication is unavailable: AUTH_TOKEN_SECRET must contain at least 32 characters.");
    const [payload, signature, extra] = token.split(".");
    const expected = Buffer.from(signPayload(payload || ""));
    const actual = Buffer.from(signature || "");
    if (extra || expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return unauthorized(res);
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!ethers.isAddress(session.sub) || !Array.isArray(session.roles) || session.exp <= Math.floor(Date.now() / 1000)) return unauthorized(res);
    req.auth = { address: ethers.getAddress(session.sub), roles: session.roles, prescriptionId: session.prescriptionId };
    return next();
  } catch (_error) {
    return unauthorized(res);
  }
}

function authorize(role) {
  return (req, res, next) => {
    const allowed = req.auth?.roles.includes(role) || (role === "patient" && req.auth?.roles.includes("patient") && req.auth.prescriptionId === req.params.id.toLowerCase());
    return allowed
      ? next()
      : res.status(403).json({ success: false, error: "FORBIDDEN", message: `The ${role} role is required.` });
  };
}

module.exports = { createChallenge, exchangeSignature, authenticate, authorize, issuedChallenges, TOKEN_TTL_SECONDS, MAX_CHALLENGE_AGE_SECONDS };
