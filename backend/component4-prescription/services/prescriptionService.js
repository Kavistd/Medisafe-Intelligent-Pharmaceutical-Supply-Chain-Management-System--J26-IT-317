/**
 * @file prescriptionService.js
 * @description Web3 read service for Component 4 PrescriptionRegistry.sol via ethers.js.
 * @author R.A.M.A. Ranasinghe (IT23142978) - Component 4
 *
 * Design decisions:
 * - Patient identity hashing and encrypted credential handling occur in the browser.
 * - The service reads ABI and contract addresses from the shared/ directory.
 * - Contract reads use the JSON-RPC provider; writes must be submitted by MetaMask.
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

let _provider = null;
let _signer = null;

function getProvider() {
  if (!_provider) {
    const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545";
    _provider = new ethers.JsonRpcProvider(rpcUrl);
  }
  return _provider;
}

function configurationError(message, code) {
  return Object.assign(new Error(message), { statusCode: 503, code });
}

async function createConfiguredSigner(provider = getProvider(), env = process.env) {
  if (env.LOCAL_RPC_SIGNER != null && !["true", "false"].includes(env.LOCAL_RPC_SIGNER)) {
    throw configurationError(
      "LOCAL_RPC_SIGNER must be explicitly set to true or false.",
      "LOCAL_SIGNER_CONFIGURATION_INVALID"
    );
  }
  if (env.LOCAL_RPC_SIGNER === "true") {
    if (!["localhost", "local"].includes(env.NETWORK)) {
      throw configurationError(
        "Local RPC signing requires NETWORK=localhost or NETWORK=local.",
        "LOCAL_SIGNER_NETWORK_MISMATCH"
      );
    }
    if (!env.BACKEND_SIGNER_ADDRESS || !ethers.isAddress(env.BACKEND_SIGNER_ADDRESS)) {
      throw configurationError(
        "BACKEND_SIGNER_ADDRESS must be a valid configured local account address.",
        "LOCAL_SIGNER_ADDRESS_REQUIRED"
      );
    }

    let network;
    try {
      network = await provider.getNetwork();
    } catch {
      throw configurationError("Unable to connect to the configured local blockchain RPC.", "LOCAL_SIGNER_RPC_UNAVAILABLE");
    }
    if (network.chainId !== 31337n) {
      throw configurationError("Local RPC signing is allowed only on chain ID 31337.", "LOCAL_SIGNER_CHAIN_MISMATCH");
    }

    let accounts;
    try {
      accounts = await provider.listAccounts();
    } catch {
      throw configurationError("Unable to read unlocked accounts from the local blockchain RPC.", "LOCAL_SIGNER_ACCOUNTS_UNAVAILABLE");
    }
    const address = ethers.getAddress(env.BACKEND_SIGNER_ADDRESS);
    const isUnlocked = accounts.some((account) => {
      const accountAddress = typeof account === "string" ? account : account.address;
      return typeof accountAddress === "string" && accountAddress.toLowerCase() === address.toLowerCase();
    });
    if (!isUnlocked) {
      throw configurationError("BACKEND_SIGNER_ADDRESS is not an unlocked account on the local RPC.", "LOCAL_SIGNER_NOT_UNLOCKED");
    }
    return new ethers.JsonRpcSigner(provider, address);
  }

  const privateKey = env.PRIVATE_KEY;
  if (!privateKey) {
    throw configurationError(
      "PRIVATE_KEY is required unless LOCAL_RPC_SIGNER=true is explicitly enabled.",
      "SIGNER_CONFIGURATION_MISSING"
    );
  }
  return new ethers.Wallet(privateKey, provider);
}

async function getSigner() {
  if (!_signer) _signer = await createConfiguredSigner();
  return _signer;
}

async function getConfiguredSignerAddress() {
  const signer = await getSigner();
  return signer.getAddress();
}

/**
 * Returns the deployed PrescriptionRegistry contract instance.
 * @param {boolean} [readOnly=false] - If true, uses provider (no signing needed).
 */
function getContract(readOnly = false) {
  if (!readOnly) {
    throw Object.assign(
      new Error("Component 4 write transactions must be submitted through the authenticated wallet in MetaMask."),
      { statusCode: 410, code: "WALLET_TRANSACTION_REQUIRED" }
    );
  }

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

  return new ethers.Contract(contractAddress, PrescriptionRegistryABI.abi, getProvider());
}

async function getBlockchainStatus({ provider = getProvider(), contract = getContract(true) } = {}) {
  let network;
  try {
    network = await provider.getNetwork();
  } catch {
    throw configurationError("Unable to connect to the configured local blockchain RPC.", "BLOCKCHAIN_RPC_UNAVAILABLE");
  }
  if (network.chainId !== 31337n) {
    throw configurationError("Component 4 is connected to the wrong blockchain network.", "BLOCKCHAIN_CHAIN_MISMATCH");
  }

  let registryAddress;
  let registryCode;
  let riskRegistryAddress;
  let riskRegistryCode;
  try {
    registryAddress = await contract.getAddress();
    registryCode = await provider.getCode(registryAddress);
    if (!registryCode || registryCode === "0x") {
      throw configurationError("No Component 4 PrescriptionRegistry is deployed at the configured address.", "PRESCRIPTION_REGISTRY_UNAVAILABLE");
    }
    riskRegistryAddress = await contract.riskRegistry();
    if (riskRegistryAddress === ethers.ZeroAddress) {
      throw configurationError("The Component 2 risk registry is not configured on Component 4.", "RISK_REGISTRY_NOT_CONFIGURED");
    }
    riskRegistryCode = await provider.getCode(riskRegistryAddress);
    if (!riskRegistryCode || riskRegistryCode === "0x") {
      throw configurationError("No Component 2 risk registry is deployed at the linked address.", "RISK_REGISTRY_UNAVAILABLE");
    }
  } catch (error) {
    if (error.statusCode) throw error;
    throw configurationError("Unable to verify the deployed Component 4 and Component 2 registries.", "BLOCKCHAIN_REGISTRY_CHECK_FAILED");
  }

  return {
    connected: true,
    chainId: Number(network.chainId),
    prescriptionRegistry: ethers.getAddress(registryAddress),
    riskRegistry: ethers.getAddress(riskRegistryAddress),
    component3Connected: false,
  };
}

/** Read-only local diagnostic for the exact provider and registry used by readiness. */
async function getBlockchainDiagnostic({ provider = getProvider(), contract = getContract(true) } = {}) {
  const network = await provider.getNetwork();
  const registryAddress = ethers.getAddress(await contract.getAddress());
  const registryCode = await provider.getCode(registryAddress);
  return {
    chainId: Number(network.chainId),
    registryAddress,
    registryBytecodeBytes: registryCode && registryCode !== "0x" ? (registryCode.length - 2) / 2 : 0,
  };
}

function rejectBackendWrite() {
  throw Object.assign(
    new Error("Component 4 write transactions must be submitted through the authenticated wallet in MetaMask."),
    { statusCode: 410, code: "WALLET_TRANSACTION_REQUIRED" }
  );
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
    medicineId: raw.medicineId,
    batchId: raw.batchId,
    doctorAddress: raw.doctorAddress,
    issuedAt: new Date(Number(raw.issuedAt) * 1000).toISOString(),
    expiryTime: new Date(Number(raw.expiryTime) * 1000).toISOString(),
    // V1 getPrescription computes expiry against block.timestamp. Use the
    // returned status so backend and contract agree even if server clocks drift.
    isExpired: statusCode === 2,
    status: PRESCRIPTION_STATUS[statusCode] || "UNKNOWN",
    statusCode,
  };
}

/**
 * Issues a new prescription on-chain.
 * Patient hash is prepared in the patient browser; the doctor wallet submits this transaction.
 */
async function issuePrescription() {
  rejectBackendWrite();
}

/**
 * Verifies a prescription on-chain and dispenses it (marks USED).
 */
async function dispensePrescription() {
  rejectBackendWrite();
}

const verifyAndDispense = dispensePrescription;

async function revokePrescription() {
  rejectBackendWrite();
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

async function verifyPrescription({ prescriptionId, patientHash }) {
  const contract = getContract(true);
  const raw = await contract.getPrescription(prescriptionId);
  await verifyPatientHashAgainstRecord(raw, () => contract.verifyPatientHash(prescriptionId, patientHash));

  return {
    success: true,
    data: {
      prescriptionId: raw.prescriptionId,
      status: PRESCRIPTION_STATUS[Number(raw.status)] || "UNKNOWN",
      expiryTime: new Date(Number(raw.expiryTime) * 1000).toISOString(),
      patientHashVerified: true,
      identityVerification: "not-performed",
    },
  };
}

async function verifyPatientHashAgainstRecord(raw, verifyHash) {
  // V1 getPrescription derives EXPIRED from the chain timestamp.
  if (Number(raw.status) === 2) {
    throw Object.assign(new Error("This prescription has expired."), { statusCode: 410, code: "PRESCRIPTION_EXPIRED" });
  }
  if (Number(raw.status) !== 0) {
    throw Object.assign(new Error("This prescription is not active."), { statusCode: 409, code: "PRESCRIPTION_NOT_ACTIVE" });
  }
  if (!(await verifyHash())) {
    throw Object.assign(new Error("Patient hash verification failed."), { statusCode: 403, code: "PATIENT_HASH_MISMATCH" });
  }
  return true;
}

async function getPrescriptionsByDoctor(doctorAddress) {
  if (!ethers.isAddress(doctorAddress)) {
    throw Object.assign(new Error("Invalid Ethereum address."), { statusCode: 400 });
  }

  let ids;
  try {
    const contract = getContract(true);
    ids = await contract.getPrescriptionsByDoctor(ethers.getAddress(doctorAddress));
  } catch {
    throw configurationError("Unable to read the authenticated doctor's prescriptions from the blockchain.", "BLOCKCHAIN_READ_FAILED");
  }

  return {
    success: true,
    data: {
      doctorAddress: ethers.getAddress(doctorAddress),
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
  verifyPatientHashAgainstRecord,
  getPrescriptionsByDoctor,
  getContract,
  getBlockchainStatus,
  getBlockchainDiagnostic,
  getProvider,
  getSigner,
  createConfiguredSigner,
  formatPrescription,
  getConfiguredSignerAddress,
};
