import {
  getAddress,
  isAddress,
  hexlify,
  randomBytes,
  solidityPackedKeccak256,
} from "ethers";
import { describeWalletProvider, getMetaMaskProvider } from "./walletProvider.js";

export const REQUIRED_CHAIN_ID = 31337n;

export { getMetaMaskProvider };

const ROLE_METHODS = {
  doctor: "DOCTOR_ROLE",
  pharmacy: "PHARMACY_ROLE",
};

export function buildIssueArguments({
  doctorAddress,
  patientHash,
  medicineId,
  batchId,
  expiryDays = 30,
  nowMs = Date.now(),
  nonce = hexlify(randomBytes(16)),
}) {
  if (!isAddress(doctorAddress)) throw new Error("The connected doctor wallet address is invalid.");
  if (!/^0x[0-9a-fA-F]{64}$/.test(patientHash || "")) throw new Error("Patient hash must be a 32-byte hexadecimal value.");
  if (!/^[A-Za-z0-9_-]{2,50}$/.test(medicineId || "")) throw new Error("Medicine ID is invalid.");
  if (!/^[A-Za-z0-9_-]{2,50}$/.test(batchId || "")) throw new Error("Batch ID is invalid.");
  const days = Number(expiryDays);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("Expiry must be between 1 and 365 days.");

  const normalizedDoctor = getAddress(doctorAddress);
  const idNonce = `${Math.floor(nowMs)}:${nonce}`;
  const prescriptionId = solidityPackedKeccak256(
    ["address", "bytes32", "string"],
    [normalizedDoctor, patientHash, idNonce]
  );
  const expiryTime = BigInt(Math.floor(nowMs / 1000) + days * 24 * 60 * 60);
  return [prescriptionId, patientHash, medicineId, batchId, expiryTime];
}

export async function assertWalletContext(ethereum, expectedAddress) {
  const wallet = ethereum || await getMetaMaskProvider();
  if (!wallet?.request) throw new Error("MetaMask is unavailable. Connect a wallet and try again.");
  if (!isAddress(expectedAddress || "")) throw new Error("The authenticated wallet address is invalid.");

  const accounts = await wallet.request({ method: "eth_accounts" });
  const connected = accounts?.[0];
  if (!connected || getAddress(connected) !== getAddress(expectedAddress)) {
    throw new Error("The connected MetaMask account changed. Sign in again with the same wallet.");
  }

  const chainId = await wallet.request({ method: "eth_chainId" });
  let parsedChainId;
  try {
    parsedChainId = BigInt(chainId);
  } catch {
    throw new Error(`The selected wallet returned an invalid chain ID (${String(chainId)}). Reconnect MetaMask and select Hardhat Local (31337).`);
  }
  if (parsedChainId !== REQUIRED_CHAIN_ID) {
    const provider = describeWalletProvider(wallet);
    const decimalChainId = parsedChainId.toString(10);
    throw new Error(
      `Network mismatch: ${provider.name} via ${provider.source} reports chain ID ${decimalChainId} (${String(chainId)}); MediSafe requires 31337 (0x7a69). Switch this wallet provider to Hardhat Local, then reconnect.`,
    );
  }
  return getAddress(connected);
}

export async function assertWalletRole(contract, address, roleName) {
  const roleMethod = ROLE_METHODS[roleName];
  if (!roleMethod) throw new Error("Unsupported Component 4 role.");
  const role = await contract[roleMethod]();
  if (!(await contract.hasRole(role, address))) {
    throw new Error(`The connected wallet does not have the on-chain ${roleName} role.`);
  }
}

export async function submitWalletTransaction({
  ethereum,
  expectedAddress,
  role,
  method,
  args,
  contractFactory,
  preflight,
  onPending,
}) {
  const address = await assertWalletContext(ethereum, expectedAddress);
  const contract = await contractFactory(ethereum, address);
  await assertWalletRole(contract, address, role);
  if (preflight) await preflight(contract, address);
  await assertWalletContext(ethereum, address);

  const resolvedArgs = typeof args === "function" ? await args(contract, address) : args;
  const transaction = await contract[method](...resolvedArgs);
  onPending?.(transaction.hash);
  const receipt = await transaction.wait();
  if (receipt?.status === 0) throw new Error("The blockchain rejected the transaction.");
  return { transactionHash: receipt?.hash || transaction.hash, blockNumber: receipt?.blockNumber };
}

export function assertPrescriptionIssuer(record, address) {
  if (!record?.doctorAddress || getAddress(record.doctorAddress) !== getAddress(address)) {
    throw new Error("Only the doctor wallet that issued this prescription can revoke it.");
  }
  if (Number(record.status) !== 0) throw new Error("Only an active prescription can be revoked.");
}

export async function assertPatientHashMatches(contract, prescriptionId, patientHash) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(patientHash || "")) throw new Error("Patient hash must be a 32-byte hexadecimal value.");
  const prescription = await contract.getPrescription(prescriptionId);
  if (Number(prescription.status) !== 0) throw new Error("This prescription is not active and cannot be dispensed.");
  if (BigInt(prescription.expiryTime) <= BigInt(Math.floor(Date.now() / 1000))) throw new Error("This prescription has expired and cannot be dispensed.");
  if (!(await contract.verifyPatientHash(prescriptionId, patientHash))) {
    throw new Error("Patient hash does not match this prescription. No transaction was sent.");
  }
}

export function transactionErrorMessage(error) {
  if (error?.code === 4001 || error?.code === "ACTION_REJECTED") return "Transaction request was rejected in MetaMask.";
  return error?.shortMessage || error?.reason || error?.message || "The wallet transaction failed.";
}
