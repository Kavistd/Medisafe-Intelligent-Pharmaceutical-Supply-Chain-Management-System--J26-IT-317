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
  patientNationalId: Joi.string().trim().min(5).max(30).required(),
  patientFullName: Joi.string().trim().min(2).max(100).required(),
  patientDateOfBirth: Joi.string()
    .trim()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .required()
    .custom((value, helpers) => {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return helpers.error("any.invalid");
      }
      if (date > new Date()) {
        return helpers.message("patientDateOfBirth cannot be in the future.");
      }
      return value;
    })
    .messages({
      "string.pattern.base": "patientDateOfBirth must be in YYYY-MM-DD format.",
    }),
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
  presentedPatientHash: bytes32Hex.optional().label("presentedPatientHash"),
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

module.exports = {
  issuePrescriptionSchema,
  dispensePrescriptionSchema,
  prescriptionIdParamSchema,
  validate,
  validateIssuePrescription,
  validateDispensePrescription,
  validatePrescriptionIdParam,
};
