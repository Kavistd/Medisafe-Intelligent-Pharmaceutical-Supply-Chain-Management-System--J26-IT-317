import { getAddress, isAddress, randomBytes, solidityPackedKeccak256 } from "ethers";
import * as aesjs from "aes-js";
import { pbkdf2Async } from "@noble/hashes/pbkdf2";
import { sha256 } from "@noble/hashes/sha256";

const ENVELOPE_VERSION = 1;
const KDF_ITERATIONS = 310000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function hasWebCryptoSubtle() {
  return typeof globalThis !== "undefined" && !!globalThis.crypto?.subtle;
}

function getRandomBytes(length) {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.getRandomValues) {
    return globalThis.crypto.getRandomValues(new Uint8Array(length));
  }
  return randomBytes(length);
}

function createAesInstance(keyBytes) {
  const AESClass =
    aesjs.AES ||
    aesjs.default?.AES ||
    aesjs.default?.default?.AES ||
    (typeof aesjs.default === "function" ? aesjs.default : null) ||
    (typeof aesjs === "function" ? aesjs : null);
  if (!AESClass) {
    throw new Error("AES cipher implementation could not be resolved.");
  }
  return new AESClass(keyBytes);
}

function gfMult(xBuf, yBuf) {
  let x = BigInt("0x" + Array.from(xBuf, (b) => b.toString(16).padStart(2, "0")).join(""));
  let y = BigInt("0x" + Array.from(yBuf, (b) => b.toString(16).padStart(2, "0")).join(""));
  const R = 0xe1n << 120n;
  let z = 0n;
  let v = y;
  for (let i = 0n; i < 128n; i++) {
    if ((x >> (127n - i)) & 1n) z ^= v;
    if (v & 1n) v = (v >> 1n) ^ R;
    else v = v >> 1n;
  }
  const hex = z.toString(16).padStart(32, "0");
  const res = new Uint8Array(16);
  for (let i = 0; i < 16; i++) res[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return res;
}

function ghash(H, data) {
  let y = new Uint8Array(16);
  for (let offset = 0; offset < data.length; offset += 16) {
    const block = data.subarray(offset, offset + 16);
    for (let j = 0; j < 16; j++) y[j] ^= block[j];
    y = gfMult(y, H);
  }
  return y;
}

function fallbackAesGcmEncrypt(keyBytes, iv, plaintext) {
  const aes = createAesInstance(keyBytes);
  const H = aes.encrypt(new Uint8Array(16));

  const J0 = new Uint8Array(16);
  J0.set(iv);
  J0[15] = 1;

  const ciphertext = new Uint8Array(plaintext.length);
  const cb = new Uint8Array(16);
  cb.set(iv, 0);
  const view = new DataView(cb.buffer, cb.byteOffset, cb.byteLength);

  let counter = 2;
  for (let offset = 0; offset < plaintext.length; offset += 16) {
    view.setUint32(12, counter >>> 0);
    counter++;
    const keystream = aes.encrypt(cb);
    const blockSize = Math.min(16, plaintext.length - offset);
    for (let j = 0; j < blockSize; j++) {
      ciphertext[offset + j] = plaintext[offset + j] ^ keystream[j];
    }
  }

  const padLen = (16 - (ciphertext.length % 16)) % 16;
  const lenBuf = new Uint8Array(16);
  const lenView = new DataView(lenBuf.buffer, lenBuf.byteOffset, lenBuf.byteLength);
  lenView.setUint32(12, ciphertext.length * 8);

  const ghashData = new Uint8Array(ciphertext.length + padLen + 16);
  ghashData.set(ciphertext, 0);
  ghashData.set(lenBuf, ciphertext.length + padLen);

  const S = ghash(H, ghashData);
  const tagMask = aes.encrypt(J0);
  const tag = new Uint8Array(16);
  for (let i = 0; i < 16; i++) tag[i] = S[i] ^ tagMask[i];

  const result = new Uint8Array(ciphertext.length + 16);
  result.set(ciphertext, 0);
  result.set(tag, ciphertext.length);
  return result;
}

function fallbackAesGcmDecrypt(keyBytes, iv, ciphertextAndTag) {
  if (ciphertextAndTag.length < 16) throw new Error("Invalid ciphertext");
  const ciphertext = ciphertextAndTag.subarray(0, ciphertextAndTag.length - 16);
  const tag = ciphertextAndTag.subarray(ciphertextAndTag.length - 16);

  const aes = createAesInstance(keyBytes);
  const H = aes.encrypt(new Uint8Array(16));

  const J0 = new Uint8Array(16);
  J0.set(iv);
  J0[15] = 1;

  const padLen = (16 - (ciphertext.length % 16)) % 16;
  const lenBuf = new Uint8Array(16);
  const lenView = new DataView(lenBuf.buffer, lenBuf.byteOffset, lenBuf.byteLength);
  lenView.setUint32(12, ciphertext.length * 8);

  const ghashData = new Uint8Array(ciphertext.length + padLen + 16);
  ghashData.set(ciphertext, 0);
  ghashData.set(lenBuf, ciphertext.length + padLen);

  const S = ghash(H, ghashData);
  const tagMask = aes.encrypt(J0);
  let tagMismatch = 0;
  for (let i = 0; i < 16; i++) {
    tagMismatch |= tag[i] ^ (S[i] ^ tagMask[i]);
  }
  if (tagMismatch !== 0) {
    throw new Error("Could not decrypt the credential. Check the passphrase and file.");
  }

  const plaintext = new Uint8Array(ciphertext.length);
  const cb = new Uint8Array(16);
  cb.set(iv, 0);
  const view = new DataView(cb.buffer, cb.byteOffset, cb.byteLength);

  let counter = 2;
  for (let offset = 0; offset < ciphertext.length; offset += 16) {
    view.setUint32(12, counter >>> 0);
    counter++;
    const keystream = aes.encrypt(cb);
    const blockSize = Math.min(16, ciphertext.length - offset);
    for (let j = 0; j < blockSize; j++) {
      plaintext[offset + j] = ciphertext[offset + j] ^ keystream[j];
    }
  }
  return plaintext;
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
  const bytes = getRandomBytes(32);
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function hashPatientCredential(identity, salt) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(salt || "")) throw new Error("Patient credential is invalid.");
  return solidityPackedKeccak256(["string", "bytes32"], [canonicalIdentity(identity), salt]);
}

async function deriveKey(passphrase, salt) {
  if (typeof passphrase !== "string" || passphrase.length < 12) throw new Error("Use a passphrase with at least 12 characters.");
  const material = await globalThis.crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return globalThis.crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: KDF_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptPatientCredential(payload, passphrase) {
  if (typeof passphrase !== "string" || passphrase.length < 12) {
    throw new Error("Use a passphrase with at least 12 characters.");
  }
  const kdfSalt = getRandomBytes(16);
  const iv = getRandomBytes(12);
  const plaintext = encoder.encode(JSON.stringify(payload));
  let ciphertext;

  if (hasWebCryptoSubtle()) {
    try {
      const key = await deriveKey(passphrase, kdfSalt);
      const enc = await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
      ciphertext = new Uint8Array(enc);
    } catch {
      const keyBytes = await pbkdf2Async(sha256, passphrase, kdfSalt, { c: KDF_ITERATIONS, dkLen: 32 });
      ciphertext = fallbackAesGcmEncrypt(keyBytes, iv, plaintext);
    }
  } else {
    const keyBytes = await pbkdf2Async(sha256, passphrase, kdfSalt, { c: KDF_ITERATIONS, dkLen: 32 });
    ciphertext = fallbackAesGcmEncrypt(keyBytes, iv, plaintext);
  }

  return JSON.stringify({
    version: ENVELOPE_VERSION,
    kdf: "PBKDF2-SHA256",
    iterations: KDF_ITERATIONS,
    salt: bytesToBase64(kdfSalt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
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

    let plaintext;
    if (hasWebCryptoSubtle()) {
      try {
        const key = await deriveKey(passphrase, kdfSalt);
        plaintext = await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
      } catch (subtleErr) {
        try {
          const keyBytes = await pbkdf2Async(sha256, passphrase, kdfSalt, { c: KDF_ITERATIONS, dkLen: 32 });
          plaintext = fallbackAesGcmDecrypt(keyBytes, iv, ciphertext);
        } catch {
          throw subtleErr;
        }
      }
    } else {
      const keyBytes = await pbkdf2Async(sha256, passphrase, kdfSalt, { c: KDF_ITERATIONS, dkLen: 32 });
      plaintext = fallbackAesGcmDecrypt(keyBytes, iv, ciphertext);
    }

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
