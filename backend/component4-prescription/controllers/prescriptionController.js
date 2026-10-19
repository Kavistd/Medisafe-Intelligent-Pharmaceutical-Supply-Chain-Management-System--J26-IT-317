/**
 * @file prescriptionController.js
 * @description Express handlers for Component 4 prescription issue, dispense, and lookup.
 * @author R.A.M.A. Ranasinghe (IT23142978) - Component 4
 */

const prescriptionService = require("../services/prescriptionService");

async function getBlockchainHealth(_req, res) {
  try {
    const data = await prescriptionService.getBlockchainStatus();
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(err.statusCode || 503).json({
      success: false,
      error: err.code || "BLOCKCHAIN_UNAVAILABLE",
      message: "Component 4 blockchain dependencies are not ready.",
    });
  }
}

function walletSubmissionRequired(operation) {
  return (_req, res) => res.status(410).json({
    success: false,
    error: "WALLET_TRANSACTION_REQUIRED",
    message: `Prescription ${operation} transactions must be submitted by the authenticated wallet through MetaMask. This API does not submit blockchain transactions.`,
  });
}

function mapError(err) {
  const diagnostic = `${err.shortMessage || ""} ${err.reason || ""} ${err.message || ""}`;
  let statusCode = err.statusCode || 500;

  if (
    /PRIVATE_KEY|not configured|No contract addresses/i.test(diagnostic) ||
    err.code === "NETWORK_ERROR"
  ) {
    statusCode = 503;
  } else if (
    /VALIDATION|Invalid Ethereum address/i.test(diagnostic) ||
    err.code === "INVALID_ARGUMENT"
  ) {
    statusCode = 400;
  } else if (
    /PrescriptionNotFound|CALL_EXCEPTION/i.test(diagnostic) ||
    err.code === "CALL_EXCEPTION"
  ) {
    statusCode = 404;
  }

  const safeMessages = {
    PATIENT_CREDENTIAL_MISMATCH: "Patient credential verification failed.",
    PRESCRIPTION_EXPIRED: "This prescription has expired.",
    PRESCRIPTION_NOT_ACTIVE: "This prescription is not active.",
  };
  let message = safeMessages[err.code];
  if (!message && statusCode === 400) message = "The prescription request is invalid.";
  if (!message && statusCode === 404) message = "The prescription record is unavailable.";
  if (!message && statusCode === 503) message = "The prescription service is temporarily unavailable.";
  if (!message) message = "The Component 4 API could not complete this request.";

  return {
    statusCode,
    body: {
      success: false,
      error: err.code || "PRESCRIPTION_ERROR",
      message,
    },
  };
}

const issuePrescription = walletSubmissionRequired("issuance");
const dispensePrescription = walletSubmissionRequired("dispensing");
const revokePrescription = walletSubmissionRequired("revocation");

async function getPrescription(req, res) {
  try {
    const prescriptionId = req.body.prescriptionId;
    const issuer = await prescriptionService.getPrescriptionIssuer(prescriptionId);
    if (issuer.toLowerCase() !== req.auth.address.toLowerCase()) {
      return res.status(403).json({ success: false, error: "FORBIDDEN", message: "Only the issuing doctor may look up this prescription." });
    }
    const result = await prescriptionService.getPrescription(prescriptionId);
    return res.status(200).json(result);
  } catch (err) {
    const mapped = mapError(err);
    return res.status(mapped.statusCode).json(mapped.body);
  }
}

async function listDoctorPrescriptions(req, res) {
  try {
    // Bind the listing to the wallet authenticated by the signed session. The
    // request body and query string are deliberately not used for the address.
    const result = await prescriptionService.getPrescriptionsByDoctor(req.auth.address);
    return res.status(200).json(result);
  } catch (err) {
    const mapped = mapError(err);
    return res.status(mapped.statusCode).json(mapped.body);
  }
}

async function verifyPrescription(req, res) {
  try {
    const result = await prescriptionService.verifyPrescription({
      prescriptionId: req.body.prescriptionId,
      ...req.body,
    });
    if (!result.data.identityVerified) {
      return res.status(403).json({ success: false, error: "PATIENT_IDENTITY_MISMATCH", message: "Patient identity verification failed." });
    }
    return res.status(200).json(result);
  } catch (err) {
    const mapped = mapError(err);
    return res.status(mapped.statusCode).json(mapped.body);
  }
}

module.exports = {
  getBlockchainHealth,
  issuePrescription,
  dispensePrescription,
  revokePrescription,
  getPrescription,
  listDoctorPrescriptions,
  verifyPrescription,
};
