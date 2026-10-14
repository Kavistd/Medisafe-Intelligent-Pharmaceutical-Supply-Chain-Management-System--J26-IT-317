/**
 * @file prescriptionService.js
 * @description Web3 service layer for Component 4 — interacts with PrescriptionRegistry.sol
 *              via ethers.js and delegates off-chain identity hashing to src/utils/privacy.js.
 * @author R.A.M.A. Ranasinghe (IT23142978) - Component 4
 *
 * Design decisions:
 * - All sensitive patient PII is hashed here (never passed to the smart contract raw).
 * - The service reads ABI and contract addresses from the shared/ directory.
 * - Signer is loaded from environment variable PRIVATE_KEY.
 * - Both "simple dispense" and "patient-hash-verified dispense" are supported.
 */

const { ethers } = require("ethers");
const path = require("path");

const PrescriptionRegistryABI = require(path.resolve(
  __dirname,
  "../../../shared/abis/PrescriptionRegistry.json"
));
const contractAddresses = require(path.resolve(
  __dirname,
  "../../../shared/blockchain/contract-addresses.json"
));

const {
  generatePrescriptionId,
  verifyPatientIdentity,
} = require(path.resolve(__dirname, "../../../src/utils/privacy"));

let _provider = null;
let _signer = null;

function getProvider() {
  if (!_provider) {
    const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545";
    _provider = new ethers.JsonRpcProvider(rpcUrl);
  }
  return _provider;
}

function getSigner() {
  if (!_signer) {
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      throw new Error(
        "PRIVATE_KEY environment variable is not set. Cannot sign transactions."
      );
    }
    _signer = new ethers.Wallet(privateKey, getProvider());
  }
  return _signer;
}

function getConfiguredSignerAddress() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) return null;
  return new ethers.Wallet(privateKey).address;
}

/**
 * Returns the deployed PrescriptionRegistry contract instance.
 * @param {boolean} [readOnly=false] - If true, uses provider (no signing needed).
 */
function getContract(readOnly = false) {
  const network = process.env.NETWORK || "localhost";
  const addresses = contractAddresses[network];
  if (!addresses) {
    throw new Error(`No contract addresses configured for network: "${network}"`);
  }

  const contractAddress = addresses.PrescriptionRegistry;
  if (!contractAddress || contractAddress === "") {
    throw new Error(
      `PrescriptionRegistry address is not configured for network: "${network}". ` +
        `Deploy the contract and update shared/blockchain/contract-addresses.json.`
    );
  }

  const runnerOrSigner = readOnly ? getProvider() : getSigner();
  return new ethers.Contract(contractAddress, PrescriptionRegistryABI.abi, runnerOrSigner);
}

async function assertSignerRole(roleName) {
  const signer = getSigner();
  const contract = getContract(true);
  const address = await signer.getAddress();
  const role = roleName === "doctor" ? await contract.DOCTOR_ROLE() : await contract.PHARMACY_ROLE();
  if (!(await contract.hasRole(role, address))) {
    throw Object.assign(new Error(`Configured service signer does not have ${roleName} role.`), { statusCode: 503, code: "SIGNER_ROLE_MISMATCH" });
  }
  return address;
}

const PRESCRIPTION_STATUS = {
  0: "ACTIVE",
  1: "USED",
  2: "EXPIRED",
  3: "REVOKED",
};

function formatPrescription(raw) {
  const statusCode = Number(raw.status);
  return {
    prescriptionId: raw.prescriptionId,
    patientHash: raw.patientHash,
    medicineId: raw.medicineId,
    batchId: raw.batchId,
    doctorAddress: raw.doctorAddress,
    issuedAt: new Date(Number(raw.issuedAt) * 1000).toISOString(),
    expiryTime: new Date(Number(raw.expiryTime) * 1000).toISOString(),
    isExpired: Number(raw.expiryTime) * 1000 < Date.now(),
    status: PRESCRIPTION_STATUS[statusCode] || "UNKNOWN",
    statusCode,
  };
}

/**
 * Issues a new prescription on-chain.
 * Patient identity is hashed off-chain with generatePatientHash; IDs come from generatePrescriptionId.
 */
async function issuePrescription({
  patientHash,
  salt,
  medicineId,
  batchId,
  expiryDays = 30,
}) {
  const signer = getSigner();
  const contract = getContract(false);
  const doctorAddress = await signer.getAddress();
  await assertSignerRole("doctor");

  const prescriptionId = generatePrescriptionId(doctorAddress, patientHash);
  const expiryTime = Math.floor(Date.now() / 1000) + expiryDays * 24 * 60 * 60;

  const tx = await contract.issuePrescription(
    prescriptionId,
    patientHash,
    medicineId,
    batchId,
    expiryTime
  );

  const receipt = await tx.wait();

  return {
    success: true,
    message: "Prescription issued successfully on-chain.",
    data: {
      prescriptionId,
      medicineId,
      batchId,
      expiryTime: new Date(expiryTime * 1000).toISOString(),
      doctorAddress,
      transactionHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      salt,
    },
  };
}

/**
 * Verifies a prescription on-chain and dispenses it (marks USED).
 */
async function dispensePrescription({
  prescriptionId,
  patientNationalId,
  patientFullName,
  patientDateOfBirth,
  salt,
}) {
  const signer = getSigner();
  const contract = getContract(false);
  await assertSignerRole("pharmacy");
  if (!patientNationalId || !patientFullName || !patientDateOfBirth || !salt) {
    throw Object.assign(new Error("Patient identity and salt are required for dispensing."), { statusCode: 400, code: "PATIENT_IDENTITY_REQUIRED" });
  }
  const raw = await contract.getPrescription(prescriptionId);
  const identityData = {
    nationalId: patientNationalId,
    fullName: patientFullName,
    dateOfBirth: patientDateOfBirth,
  };
  if (!verifyPatientIdentity(identityData, salt, raw.patientHash)) {
    throw Object.assign(new Error("Patient identity verification failed."), {
      statusCode: 403,
      code: "PATIENT_IDENTITY_MISMATCH",
    });
  }

  const tx = await contract.verifyAndDispenseWithPatientHash(prescriptionId, raw.patientHash);

  const receipt = await tx.wait();

  return {
    success: true,
    message: "Prescription successfully verified and dispensed.",
    data: {
      prescriptionId,
      pharmacyAddress: await signer.getAddress(),
      patientVerified: true,
      transactionHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      dispensedAt: new Date().toISOString(),
    },
  };
}

const verifyAndDispense = dispensePrescription;

async function revokePrescription({ prescriptionId, reason }) {
  const signer = getSigner();
  const contract = getContract(false);
  await assertSignerRole("doctor");

  const tx = await contract.revokePrescription(prescriptionId, reason);
  const receipt = await tx.wait();

  return {
    success: true,
    message: "Prescription revoked successfully.",
    data: {
      prescriptionId,
      reason,
      revokedBy: await signer.getAddress(),
      transactionHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      revokedAt: new Date().toISOString(),
    },
  };
}

async function getPrescriptionIssuer(prescriptionId) {
  const contract = getContract(true);
  const raw = await contract.getPrescription(prescriptionId);
  return raw.doctorAddress;
}

async function getPrescription(prescriptionId) {
  const contract = getContract(true);
  const raw = await contract.getPrescription(prescriptionId);
  const formatted = formatPrescription(raw);

  const { issuedAt, expiryTime, isExpired, status, statusCode } = formatted;
  return { success: true, data: { prescriptionId, issuedAt, expiryTime, isExpired, status, statusCode } };
}

async function verifyPrescription({
  prescriptionId,
  patientNationalId,
  patientFullName,
  patientDateOfBirth,
  salt,
}) {
  const contract = getContract(true);
  const raw = await contract.getPrescription(prescriptionId);
  let identityVerified = null;

  if (patientNationalId && patientFullName && patientDateOfBirth && salt) {
    const identityData = {
      nationalId: patientNationalId,
      fullName: patientFullName,
      dateOfBirth: patientDateOfBirth,
    };
    identityVerified = verifyPatientIdentity(identityData, salt, raw.patientHash);
  }

  return {
    success: true,
    data: {
      prescriptionId: raw.prescriptionId,
      status: PRESCRIPTION_STATUS[Number(raw.status)] || "UNKNOWN",
      expiryTime: new Date(Number(raw.expiryTime) * 1000).toISOString(),
      identityVerified,
    },
  };
}

async function getPrescriptionsByDoctor(doctorAddress) {
  const contract = getContract(true);

  if (!ethers.isAddress(doctorAddress)) {
    throw Object.assign(new Error("Invalid Ethereum address."), { statusCode: 400 });
  }

  const ids = await contract.getPrescriptionsByDoctor(doctorAddress);

  return {
    success: true,
    data: {
      doctorAddress,
      prescriptionIds: ids,
      count: ids.length,
    },
  };
}

module.exports = {
  issuePrescription,
  dispensePrescription,
  verifyAndDispense,
  revokePrescription,
  getPrescriptionIssuer,
  getPrescription,
  verifyPrescription,
  getPrescriptionsByDoctor,
  getContract,
  formatPrescription,
  assertSignerRole,
  getConfiguredSignerAddress,
};
