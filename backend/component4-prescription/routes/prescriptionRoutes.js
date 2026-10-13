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
} = require("../validators/prescriptionValidator");
const {
  issuePrescription,
  dispensePrescription,
  getPrescription,
} = require("../controllers/prescriptionController");

const router = express.Router();

router.post("/issue", validateIssuePrescription, issuePrescription);
router.post("/dispense", validateDispensePrescription, dispensePrescription);
router.get("/:id", validatePrescriptionIdParam, getPrescription);

module.exports = router;
