/**
 * @file privacy.js
 * @description Privacy-Preserving Off-Chain Patient Identity Hashing Utility (Component 4)
 * @author R.A.M.A. Ranasinghe (IT23142978) - Component 4
 *
 * This module ensures that sensitive Personally Identifiable Information (PII) such as
 * National Identity Card (NIC) numbers, names, and dates of birth are NEVER transmitted to
 * or stored on the public blockchain.
 *
 * Instead, a cryptographically secure off-chain one-way hash (Keccak-256) combined with a
 * unique cryptographic salt is generated on the client side using ethers.js.
 * Only the irreversible 32-byte hash (`patientHash`) is stored in the PrescriptionRegistry smart contract.
 */

const path = require("path");
const crypto = require("crypto");

let ethers;
try {
  ethers = require("ethers");
} catch (e1) {
  try {
    const hardhatModule = require("hardhat");
    ethers = hardhatModule.ethers || hardhatModule;
  } catch (e2) {
    try {
      ethers = require(path.resolve(__dirname, "../../blockchain/node_modules/ethers"));
    } catch (e3) {
      ethers = null;
    }
  }
}
if (ethers && ethers.ethers) {
  ethers = ethers.ethers;
}

/**
 * Normalizes patient identity fields into a canonical deterministic string representation.
 * Trims whitespace and converts string values to lowercase to avoid minor formatting mismatches.
 *
 * @param {string|object} identityData - Patient ID string or structured identity object.
 * @returns {string} Canonical string representation.
 */
function normalizeIdentityData(identityData) {
  if (!identityData) {
    throw new Error("Identity data must be provided");
  }

  if (typeof identityData === "string") {
    const trimmed = identityData.trim();
    if (!trimmed) {
      throw new Error("Identity string cannot be empty");
    }
    return trimmed;
  }

  if (typeof identityData === "object") {
    // Sort keys to guarantee deterministic canonicalization
    const sortedKeys = Object.keys(identityData).sort();
    if (sortedKeys.length === 0) {
      throw new Error("Identity object cannot be empty");
    }

    const canonicalParts = sortedKeys.map((key) => {
      const val = identityData[key];
      const stringVal = val !== undefined && val !== null ? String(val).trim() : "";
      return `${key.toLowerCase().trim()}:${stringVal.toLowerCase()}`;
    });

    return canonicalParts.join("|");
  }

  throw new Error("Invalid identity data format. Expected string or object.");
}

/**
 * Generates a cryptographically secure random salt hex string.
 *
 * @param {number} [byteLength=32] - Number of random bytes (default 32 bytes = 256 bits).
 * @returns {string} 0x-prefixed hex string of the salt.
 */
function generateSalt(byteLength = 32) {
  if (ethers && ethers.randomBytes) {
    // Ethers v6
    return ethers.hexlify(ethers.randomBytes(byteLength));
  } else if (ethers && ethers.utils && ethers.utils.randomBytes) {
    // Ethers v5
    return ethers.utils.hexlify(ethers.utils.randomBytes(byteLength));
  } else {
    // Native Node.js crypto fallback
    return "0x" + crypto.randomBytes(byteLength).toString("hex");
  }
}

/**
 * Performs client-side off-chain Keccak-256 patient identity hashing using ethers.js.
 * Combines the canonical patient identity data with a cryptographic salt to produce
 * a bytes32 hash safe for on-chain storage.
 *
 * @param {string|object} identityData - Raw patient information (e.g. NIC, name, DOB).
 * @param {string} [salt] - Hex salt string (0x...). If omitted, an empty bytes32 salt is assumed.
 * @returns {string} 32-byte 0x-prefixed hex string (bytes32 patientHash).
 */
function hashPatientIdentity(identityData, salt = "0x0000000000000000000000000000000000000000000000000000000000000000") {
  const canonicalData = normalizeIdentityData(identityData);

  // Normalize salt format
  let cleanSalt = salt;
  if (!cleanSalt.startsWith("0x")) {
    cleanSalt = "0x" + cleanSalt;
  }

  // Ensure cleanSalt is padded to 32 bytes (64 hex characters + "0x")
  if (cleanSalt.length < 66) {
    if (ethers && ethers.zeroPadValue) {
      cleanSalt = ethers.zeroPadValue(cleanSalt, 32);
    } else if (ethers && ethers.utils && ethers.utils.hexZeroPad) {
      cleanSalt = ethers.utils.hexZeroPad(cleanSalt, 32);
    } else {
      const rawHex = cleanSalt.slice(2).padStart(64, "0");
      cleanSalt = "0x" + rawHex;
    }
  }

  // Use ethers solidity packed hashing to mimic Solidity's keccak256(abi.encodePacked(data, salt))
  if (ethers && ethers.solidityPackedKeccak256) {
    // Ethers v6
    return ethers.solidityPackedKeccak256(["string", "bytes32"], [canonicalData, cleanSalt]);
  } else if (ethers && ethers.utils && ethers.utils.solidityKeccak256) {
    // Ethers v5
    return ethers.utils.solidityKeccak256(["string", "bytes32"], [canonicalData, cleanSalt]);
  } else {
    // Fallback: UTF-8 encoding followed by keccak256
    const dataBytes = Buffer.from(canonicalData, "utf8");
    const saltBytes = Buffer.from(cleanSalt.slice(2), "hex");
    const combined = Buffer.concat([dataBytes, saltBytes]);
    if (ethers && ethers.keccak256) {
      return ethers.keccak256(combined);
    } else if (ethers && ethers.utils && ethers.utils.keccak256) {
      return ethers.utils.keccak256(combined);
    } else {
      return "0x" + crypto.createHash("sha3-256").update(combined).digest("hex");
    }
  }
}

/**
 * Verifies if the provided raw patient identity data and salt match an expected on-chain patientHash.
 *
 * @param {string|object} identityData - Raw patient identity to verify.
 * @param {string} salt - Cryptographic salt used during initial hashing.
 * @param {string} expectedHash - The patientHash retrieved from the smart contract or QR code.
 * @returns {boolean} True if hashes match exactly, false otherwise.
 */
function verifyPatientIdentity(identityData, salt, expectedHash) {
  if (!expectedHash) return false;
  try {
    const computedHash = hashPatientIdentity(identityData, salt);
    return computedHash.toLowerCase() === expectedHash.toLowerCase();
  } catch (error) {
    return false;
  }
}

/**
 * Generates a unique 32-byte prescription ID using Keccak-256.
 *
 * @param {string} doctorAddress - Ethereum address of the issuing doctor.
 * @param {string} patientHash - Bytes32 patient identity hash.
 * @param {number|string} [nonce] - Random nonce or timestamp (defaults to current time).
 * @returns {string} 32-byte hex string (bytes32 prescriptionId).
 */
function generatePrescriptionId(doctorAddress, patientHash, nonce = Date.now()) {
  const nonceString = String(nonce);
  if (ethers && ethers.solidityPackedKeccak256) {
    return ethers.solidityPackedKeccak256(
      ["address", "bytes32", "string"],
      [doctorAddress, patientHash, nonceString]
    );
  } else if (ethers && ethers.utils && ethers.utils.solidityKeccak256) {
    return ethers.utils.solidityKeccak256(
      ["address", "bytes32", "string"],
      [doctorAddress, patientHash, nonceString]
    );
  } else {
    const raw = `${doctorAddress}:${patientHash}:${nonceString}`;
    return "0x" + crypto.createHash("sha3-256").update(Buffer.from(raw)).digest("hex");
  }
}

/**
 * Constructs a privacy-preserving prescription creation package.
 * Prepares the on-chain issuance parameters while safely isolating the raw PII.
 *
 * @param {object} params - Input parameters.
 * @param {string|object} params.identityData - Raw patient identity information.
 * @param {string} params.medicineId - Medicine identifier / name.
 * @param {string} params.batchId - Medicine batch ID.
 * @param {string} params.doctorAddress - Issuing doctor's address.
 * @param {number} [params.expiryDays=30] - Prescription validity duration in days.
 * @param {string} [params.customSalt] - Optional custom salt. If not provided, a secure salt is generated.
 * @returns {object} Object containing on-chain transaction parameters and off-chain private record.
 */
function createPrescriptionPayload({
  identityData,
  medicineId,
  batchId,
  doctorAddress,
  expiryDays = 30,
  customSalt = null,
}) {
  const salt = customSalt || generateSalt();
  const patientHash = hashPatientIdentity(identityData, salt);
  const prescriptionId = generatePrescriptionId(doctorAddress, patientHash);

  const currentTimestamp = Math.floor(Date.now() / 1000);
  const expiryTime = currentTimestamp + expiryDays * 24 * 60 * 60;

  return {
    // Data submitted to blockchain (Zero PII revealed)
    onChainData: {
      prescriptionId,
      patientHash,
      medicineId,
      batchId,
      expiryTime,
    },
    // Sensitive data stored only in patient's private possession or encrypted local storage
    offChainPrivateData: {
      rawIdentity: identityData,
      salt,
      issuedAt: currentTimestamp,
    },
  };
}

module.exports = {
  normalizeIdentityData,
  generateSalt,
  hashPatientIdentity,
  verifyPatientIdentity,
  generatePrescriptionId,
  createPrescriptionPayload,
};
