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
  validateIssuePrescription,
  validateDispensePrescription,
  validatePrescriptionLookup,
  validateVerifyPrescription,
  validateRevokePrescription,
} = require("../validators/prescriptionValidator");
const { createChallenge, exchangeSignature, authenticate, authorize } = require("../middleware/auth");
const {
  issuePrescription,
  dispensePrescription,
  getPrescription,
  listDoctorPrescriptions,
  verifyPrescription,
  revokePrescription,
} = require("../controllers/prescriptionController");

const router = express.Router();

router.post("/auth/challenge", createChallenge);
router.post("/auth/token", exchangeSignature);
router.post("/issue", authenticate, authorize("doctor"), validateIssuePrescription, issuePrescription);
router.post("/dispense", authenticate, authorize("pharmacy"), validateDispensePrescription, dispensePrescription);
router.post("/verify", authenticate, validateVerifyPrescription, authorize("patient"), verifyPrescription);
router.get("/mine", authenticate, authorize("doctor"), listDoctorPrescriptions);
router.post("/lookup", authenticate, validatePrescriptionLookup, authorize("doctor"), getPrescription);
router.post("/revoke", authenticate, authorize("doctor"), validateRevokePrescription, revokePrescription);

module.exports = router;
