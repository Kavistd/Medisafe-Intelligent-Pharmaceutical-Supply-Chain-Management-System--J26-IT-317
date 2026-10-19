const Ajv = require('ajv');
const { getAddress, ZeroAddress } = require('ethers');
const schema = require('../../../shared/schemas/medicineBatch.schema.json');
const { ApiError } = require('../blockchain/client');
const validateBatch = new Ajv({ allErrors: true }).compile(schema);
const invalid = message => { throw new ApiError(400, 'VALIDATION_ERROR', message); };
function text(value, label) {
  if (typeof value !== 'string' || !/[^\u0000-\u0020]/.test(value)) invalid(`${label} must be nonblank text.`);
  return value; // IDs are exact, case-sensitive contract keys. Never normalize.
}
function address(value, label) {
  try { const result = getAddress(value); if (result === ZeroAddress) throw new Error(); return result; }
  catch { invalid(`${label} must be a nonzero Ethereum address.`); }
}
function body(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !fields.includes(key)) || fields.some(key => !Object.hasOwn(value, key))) invalid(`Expected exactly: ${fields.join(', ')}.`);
  return value;
}
function transferId(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,77}$/.test(value) || BigInt(value) >= 2n ** 256n) invalid('transferId must be a positive uint256 decimal string.');
  return value;
}
function registration(value) {
  if (!validateBatch(value)) invalid('batch must match shared/schemas/medicineBatch.schema.json.');
  if (value.expiresAt <= value.manufacturedAt) invalid('expiresAt must be after manufacturedAt.');
  // The contract simulation checks timestamps against chain time, not server time.
  return value;
}
module.exports = { text, address, body, transferId, registration };
