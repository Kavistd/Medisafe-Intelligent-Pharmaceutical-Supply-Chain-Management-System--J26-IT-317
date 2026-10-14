/**
 * @file prescriptionRoutes.js
 * @description Express router for Component 4 prescription APIs.
 *              Mount at `/api/v1/prescriptions`.
 * @author R.A.M.A. Ranasinghe (IT23142978) - Component 4
 *
 * Wallet writes remain authenticated API paths for a clear migration error,
 * but return 410 and never submit a transaction. Reads stay on the backend.
 */

const express = require("express");
const {
  validatePrescriptionLookup,
  validateVerifyPrescription,
} = require("../validators/prescriptionValidator");
const { createChallenge, exchangeSignature, authenticate, authorize } = require("../middleware/auth");
const {
  issuePrescription,
  dispensePrescription,
  getPrescription,
  verifyPrescription,
  revokePrescription,
} = require("../controllers/prescriptionController");

const router = express.Router();

router.post("/auth/challenge", createChallenge);
router.post("/auth/token", exchangeSignature);
router.post("/issue", authenticate, authorize("doctor"), issuePrescription);
router.post("/dispense", authenticate, authorize("pharmacy"), dispensePrescription);
router.post("/verify", authenticate, validateVerifyPrescription, authorize("patient"), verifyPrescription);
router.post("/lookup", authenticate, validatePrescriptionLookup, authorize("doctor"), getPrescription);
router.post("/revoke", authenticate, authorize("doctor"), revokePrescription);

module.exports = router;
