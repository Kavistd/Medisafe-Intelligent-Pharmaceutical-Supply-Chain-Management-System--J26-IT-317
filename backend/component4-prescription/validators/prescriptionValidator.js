/**
 * @file prescriptionValidator.js
 * @description Joi schemas and Express validation middleware for Component 4 prescription APIs.
 * @author R.A.M.A. Ranasinghe (IT23142978) - Component 4
 */

const Joi = require("joi");

const bytes32Hex = Joi.string()
  .trim()
  .pattern(/^0x[0-9a-fA-F]{64}$/)
  .messages({
    "string.pattern.base": "{{#label}} must be a valid 0x-prefixed 32-byte hex string.",
  });

/**
 * Validates POST /api/v1/prescriptions/issue
 * Raw patient identity is accepted here and hashed off-chain by the service layer.
 */
const issuePrescriptionSchema = Joi.object({
  patientHash: bytes32Hex.required().label("patientHash"),
  medicineId: Joi.string()
    .trim()
    .min(2)
    .max(50)
    .pattern(/^[A-Za-z0-9\-_]+$/)
    .required()
    .messages({
      "string.pattern.base":
        "medicineId must contain only alphanumeric characters, hyphens, and underscores.",
    }),
  batchId: Joi.string()
    .trim()
    .min(2)
    .max(50)
    .pattern(/^[A-Za-z0-9\-_]+$/)
    .required()
    .messages({
      "string.pattern.base":
        "batchId must contain only alphanumeric characters, hyphens, and underscores.",
    }),
  expiryDays: Joi.number().integer().min(1).max(365).default(30),
});

/**
 * Validates POST /api/v1/prescriptions/dispense
 */
const dispensePrescriptionSchema = Joi.object({
  prescriptionId: bytes32Hex.required().label("prescriptionId"),
  patientNationalId: Joi.string().trim().min(5).max(30).required(),
  patientFullName: Joi.string().trim().min(2).max(100).required(),
  patientDateOfBirth: Joi.string().trim().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  salt: bytes32Hex.required().label("salt"),
});

const verifyPrescriptionSchema = Joi.object({
  patientNationalId: Joi.string().trim().min(5).max(30).required(),
  patientFullName: Joi.string().trim().min(2).max(100).required(),
  patientDateOfBirth: Joi.string().trim().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  salt: bytes32Hex.required().label("salt"),
});

const revokePrescriptionSchema = Joi.object({
  reason: Joi.string().trim().min(1).max(500).required(),
});

/**
 * Validates GET /api/v1/prescriptions/:id
 */
const prescriptionIdParamSchema = Joi.object({
  id: bytes32Hex.required().label("id"),
});

function formatJoiError(error) {
  return error.details.map((detail) => ({
    field: detail.path.join("."),
    message: detail.message,
    value: detail.context && detail.context.value,
  }));
}

/**
 * Express middleware factory that validates req[property] against a Joi schema.
 */
function validate(schema, property = "body") {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        error: "VALIDATION_ERROR",
        message: "Request validation failed.",
        details: formatJoiError(error),
      });
    }

    req[property] = value;
    return next();
  };
}

const validateIssuePrescription = validate(issuePrescriptionSchema, "body");
const validateDispensePrescription = validate(dispensePrescriptionSchema, "body");
const validatePrescriptionIdParam = validate(prescriptionIdParamSchema, "params");
const validateVerifyPrescription = validate(verifyPrescriptionSchema, "body");
const validateRevokePrescription = validate(revokePrescriptionSchema, "body");

module.exports = {
  issuePrescriptionSchema,
  dispensePrescriptionSchema,
  prescriptionIdParamSchema,
  verifyPrescriptionSchema,
  revokePrescriptionSchema,
  validate,
  validateIssuePrescription,
  validateDispensePrescription,
  validatePrescriptionIdParam,
  validateVerifyPrescription,
  validateRevokePrescription,
};
