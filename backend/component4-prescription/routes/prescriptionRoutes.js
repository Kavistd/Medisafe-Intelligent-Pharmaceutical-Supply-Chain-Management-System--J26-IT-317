/**
 * @file prescriptionRoutes.js
 * @description Express router for Component 4 prescription APIs.
 *              Mount at `/api/v1/prescriptions`.
 * @author R.A.M.A. Ranasinghe (IT23142978) - Component 4
 *
 * Endpoints:
 *   POST /api/v1/prescriptions/issue
 *   POST /api/v1/prescriptions/dispense
 *   GET  /api/v1/prescriptions/:id
 */

const express = require("express");
const {
  validateIssuePrescription,
  validateDispensePrescription,
  validatePrescriptionIdParam,
  validateVerifyPrescription,
  validateRevokePrescription,
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
router.post("/issue", authenticate, authorize("doctor"), validateIssuePrescription, issuePrescription);
router.post("/dispense", authenticate, authorize("pharmacy"), validateDispensePrescription, dispensePrescription);
router.post("/:id/verify", authenticate, authorize("patient"), validatePrescriptionIdParam, validateVerifyPrescription, verifyPrescription);
router.post("/:id/revoke", authenticate, authorize("doctor"), validatePrescriptionIdParam, validateRevokePrescription, revokePrescription);
router.get("/:id", authenticate, authorize("doctor"), validatePrescriptionIdParam, getPrescription);

module.exports = router;
