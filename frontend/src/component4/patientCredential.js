import { getAddress, isAddress, solidityPackedKeccak256 } from "ethers";

const ENVELOPE_VERSION = 1;
const KDF_ITERATIONS = 310000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function webCrypto() {
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
    throw new Error("Secure browser encryption is unavailable. Use a current browser over HTTPS or localhost.");
  }
  return globalThis.crypto;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("Credential file is invalid.");
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function canonicalIdentity(identity) {
  const values = {
    dateOfBirth: identity?.dateOfBirth,
    fullName: identity?.fullName,
    nationalId: identity?.nationalId,
  };
  if (Object.values(values).some((value) => typeof value !== "string" || !value.trim())) {
    throw new Error("Enter the required patient identity details.");
  }
  if (Object.values(values).some((value) => value.includes("|"))) {
    throw new Error("Patient identity fields cannot contain the reserved | separator.");
  }
  return Object.keys(values).sort().map((key) => `${key.toLowerCase()}:${values[key].trim().toLowerCase()}`).join("|");
}

export function generatePatientSalt() {
  return `0x${Array.from(webCrypto().getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function hashPatientCredential(identity, salt) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(salt || "")) throw new Error("Patient credential is invalid.");
  return solidityPackedKeccak256(["string", "bytes32"], [canonicalIdentity(identity), salt]);
}

async function deriveKey(passphrase, salt) {
  if (typeof passphrase !== "string" || passphrase.length < 12) throw new Error("Use a passphrase with at least 12 characters.");
  const material = await webCrypto().subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return webCrypto().subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: KDF_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptPatientCredential(payload, passphrase) {
  const crypto = webCrypto();
  const kdfSalt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, kdfSalt);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(payload)));
  return JSON.stringify({
    version: ENVELOPE_VERSION,
    kdf: "PBKDF2-SHA256",
    iterations: KDF_ITERATIONS,
    salt: bytesToBase64(kdfSalt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  });
}

export async function decryptPatientCredential(serialized, passphrase) {
  if (typeof serialized !== "string" || serialized.length > 128 * 1024) throw new Error("Credential file is invalid or too large.");
  let envelope;
  try { envelope = JSON.parse(serialized); } catch { throw new Error("Credential file is invalid."); }
  if (!envelope || envelope.version !== ENVELOPE_VERSION || envelope.kdf !== "PBKDF2-SHA256" || envelope.iterations !== KDF_ITERATIONS) {
    throw new Error("Credential file format is not supported.");
  }
  try {
    const kdfSalt = base64ToBytes(envelope.salt);
    const iv = base64ToBytes(envelope.iv);
    const ciphertext = base64ToBytes(envelope.ciphertext);
    if (kdfSalt.length !== 16 || iv.length !== 12 || ciphertext.length < 17) throw new Error("Invalid encrypted envelope.");
    const key = await deriveKey(passphrase, kdfSalt);
    const plaintext = await webCrypto().subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return JSON.parse(decoder.decode(plaintext));
  } catch {
    throw new Error("Could not decrypt the credential. Check the passphrase and file.");
  }
}

export function assertPresentationScope(credential, { prescriptionId, chainId, registryAddress, pharmacyAddress, nowSeconds = Math.floor(Date.now() / 1000) }) {
  if (!credential || credential.kind !== "medisafe-patient-presentation-v1" ||
      typeof prescriptionId !== "string" || credential.prescriptionId?.toLowerCase() !== prescriptionId.toLowerCase() ||
      String(credential.chainId) !== String(chainId) || !isAddress(registryAddress || "") ||
      getAddress(credential.registryAddress || "") !== getAddress(registryAddress) ||
      !isAddress(pharmacyAddress || "") || !isAddress(credential.pharmacyAddress || "") ||
      getAddress(credential.pharmacyAddress) !== getAddress(pharmacyAddress) ||
      !/^0x[0-9a-fA-F]{64}$/.test(credential.patientHash || "")) {
    throw new Error("This patient credential is not valid for the selected prescription and registry.");
  }
  if (!Number.isSafeInteger(Number(credential.expiryTime)) || Number(credential.expiryTime) <= nowSeconds) {
    throw new Error("This patient credential has expired.");
  }
  return credential.patientHash;
}
