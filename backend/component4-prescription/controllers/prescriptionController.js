/**
 * @file prescriptionController.js
 * @description Express handlers for Component 4 prescription issue, dispense, and lookup.
 * @author R.A.M.A. Ranasinghe (IT23142978) - Component 4
 */

const prescriptionService = require("../services/prescriptionService");

function mapError(err) {
  const message = err.shortMessage || err.reason || err.message || "Unexpected error.";
  let statusCode = err.statusCode || 500;

  if (
    /PRIVATE_KEY|not configured|No contract addresses/i.test(message) ||
    err.code === "NETWORK_ERROR"
  ) {
    statusCode = 503;
  } else if (
    /VALIDATION|Invalid Ethereum address/i.test(message) ||
    err.code === "INVALID_ARGUMENT"
  ) {
    statusCode = 400;
  } else if (
    /PrescriptionNotFound|CALL_EXCEPTION/i.test(message) ||
    err.code === "CALL_EXCEPTION"
  ) {
    statusCode = 404;
  }

  return {
    statusCode,
    body: {
      success: false,
      error: err.code || "PRESCRIPTION_ERROR",
      message,
    },
  };
}

async function issuePrescription(req, res) {
  try {
    const result = await prescriptionService.issuePrescription(req.body);
    return res.status(201).json(result);
  } catch (err) {
    const mapped = mapError(err);
    return res.status(mapped.statusCode).json(mapped.body);
  }
}

async function dispensePrescription(req, res) {
  try {
    const result = await prescriptionService.dispensePrescription(req.body);
    return res.status(200).json(result);
  } catch (err) {
    const mapped = mapError(err);
    return res.status(mapped.statusCode).json(mapped.body);
  }
}

async function getPrescription(req, res) {
  try {
    const result = await prescriptionService.getPrescription(req.params.id);
    return res.status(200).json(result);
  } catch (err) {
    const mapped = mapError(err);
    return res.status(mapped.statusCode).json(mapped.body);
  }
}

module.exports = {
  issuePrescription,
  dispensePrescription,
  getPrescription,
};
