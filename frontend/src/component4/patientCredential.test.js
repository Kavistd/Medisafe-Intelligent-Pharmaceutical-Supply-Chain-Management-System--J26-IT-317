import assert from "node:assert/strict";
import test from "node:test";
import { solidityPackedKeccak256 } from "ethers";
import {
  assertPresentationScope,
  decryptPatientCredential,
  encryptPatientCredential,
  generatePatientSalt,
  hashPatientCredential,
} from "./patientCredential.js";

const identity = { nationalId: "ABC12345", fullName: "Example Person", dateOfBirth: "1990-01-01" };
const salt = `0x${"a".repeat(64)}`;
const patientHash = `0x${"b".repeat(64)}`;
const registryAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const pharmacyAddress = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const prescriptionId = `0x${"c".repeat(64)}`;

test("client hashing matches the existing Component 4 canonical hash format", () => {
  const canonical = "dateofbirth:1990-01-01|fullname:example person|nationalid:abc12345";
  assert.equal(hashPatientCredential(identity, salt), solidityPackedKeccak256(["string", "bytes32"], [canonical, salt]));
  assert.match(generatePatientSalt(), /^0x[0-9a-f]{64}$/);
  assert.throws(() => hashPatientCredential({ ...identity, fullName: "Example|nationalId:collision" }, salt), /reserved/);
});

test("AES-GCM patient files round-trip and ciphertext does not reveal identity or salt", async () => {
  const passphrase = "correct horse battery staple 2026";
  const plaintext = JSON.stringify({ kind: "medisafe-patient-preparation-v1", identity, salt });
  const envelope = await encryptPatientCredential(JSON.parse(plaintext), passphrase);
  assert.equal(envelope.includes("ABC12345"), false);
  assert.equal(envelope.includes("Example Person"), false);
  assert.equal(envelope.includes(salt), false);
  assert.deepEqual(await decryptPatientCredential(envelope, passphrase), JSON.parse(plaintext));
  await assert.rejects(decryptPatientCredential(envelope, "wrong passphrase"), /Could not decrypt/);
  const tampered = JSON.parse(envelope); tampered.ciphertext = `${tampered.ciphertext.slice(0, -3)}xyz`;
  await assert.rejects(decryptPatientCredential(JSON.stringify(tampered), passphrase), /Could not decrypt/);
});

test("presentation credential is prescription, registry, chain, and expiry scoped", () => {
  const credential = { kind: "medisafe-patient-presentation-v1", prescriptionId, chainId: 31337, registryAddress, pharmacyAddress, expiryTime: 2_000_000_000, patientHash };
  const context = { prescriptionId, chainId: 31337, registryAddress, pharmacyAddress, nowSeconds: 1_900_000_000 };
  assert.equal(assertPresentationScope(credential, context), patientHash);
  assert.throws(() => assertPresentationScope(credential, { ...context, prescriptionId: `0x${"d".repeat(64)}` }), /not valid/);
  assert.throws(() => assertPresentationScope(credential, { ...context, chainId: 1 }), /not valid/);
  assert.throws(() => assertPresentationScope(credential, { ...context, pharmacyAddress: "0x0000000000000000000000000000000000000001" }), /not valid/);
  assert.throws(() => assertPresentationScope(credential, { ...context, nowSeconds: 2_000_000_000 }), /expired/);
});
