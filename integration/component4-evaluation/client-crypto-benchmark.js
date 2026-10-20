const path = require('node:path');
const { webcrypto } = require('node:crypto');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '../..');
const blockchainRequire = createRequire(path.join(ROOT, 'blockchain/package.json'));
const { solidityPackedKeccak256 } = blockchainRequire('ethers');

const subtle = webcrypto.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const KDF_ITERATIONS = 310000;

function canonicalIdentity(identity) {
  const values = {
    dateOfBirth: identity?.dateOfBirth,
    fullName: identity?.fullName,
    nationalId: identity?.nationalId,
  };
  return Object.keys(values).sort().map((key) => `${key.toLowerCase()}:${values[key].trim().toLowerCase()}`).join("|");
}

function generatePatientSalt() {
  return `0x${Array.from(webcrypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function hashPatientCredential(identity, salt) {
  return solidityPackedKeccak256(["string", "bytes32"], [canonicalIdentity(identity), salt]);
}

async function deriveKey(passphrase, salt) {
  const material = await subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: KDF_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptPatientCredential(payload, passphrase) {
  const kdfSalt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, kdfSalt);
  const ciphertext = await subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(payload)));
  return { ciphertext, iv, kdfSalt };
}

async function decryptPatientCredential(encrypted, passphrase) {
  const key = await deriveKey(passphrase, encrypted.kdfSalt);
  const decrypted = await subtle.decrypt({ name: "AES-GCM", iv: encrypted.iv }, key, encrypted.ciphertext);
  return JSON.parse(decoder.decode(decrypted));
}

async function benchmarkClientCrypto(iterations = 5) {
  const measurements = {
    canonicalizeAndHashMs: [],
    encryptionWithKdfMs: [],
    decryptionWithKdfMs: []
  };

  const sampleIdentity = {
    nationalId: "200012345678",
    fullName: "A. B. C. Perera",
    dateOfBirth: "2000-01-15"
  };
  const passphrase = "StrongPassphrase#2026!";

  for (let i = 0; i < iterations; i++) {
    const salt = generatePatientSalt();
    
    // 1. Hashing
    const t0 = performance.now();
    const hash = hashPatientCredential(sampleIdentity, salt);
    measurements.canonicalizeAndHashMs.push(performance.now() - t0);

    // 2. Encryption (includes PBKDF2 key derivation)
    const t1 = performance.now();
    const encrypted = await encryptPatientCredential({ identity: sampleIdentity, salt, hash }, passphrase);
    measurements.encryptionWithKdfMs.push(performance.now() - t1);

    // 3. Decryption
    const t2 = performance.now();
    await decryptPatientCredential(encrypted, passphrase);
    measurements.decryptionWithKdfMs.push(performance.now() - t2);
  }

  return measurements;
}

module.exports = {
  benchmarkClientCrypto,
  canonicalIdentity,
  generatePatientSalt,
  hashPatientCredential
};
