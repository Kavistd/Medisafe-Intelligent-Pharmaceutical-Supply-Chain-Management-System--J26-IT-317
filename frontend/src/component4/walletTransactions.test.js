import assert from "node:assert/strict";
import test from "node:test";
import { Interface } from "ethers";
import registryAbi from "./prescriptionRegistryAbi.json" with { type: "json" };
import deployedRegistryAbi from "../../../shared/abis/PrescriptionRegistry.json" with { type: "json" };
import {
  assertPatientHashMatches,
  assertPrescriptionIssuer,
  assertWalletContext,
  assertWalletRole,
  buildIssueArguments,
  submitWalletTransaction,
} from "./walletTransactions.js";

const doctorAddress = "0x2a13ee1f4C69386864A271Bceb401fcd3d91c942";
const pharmacyAddress = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const patientHash = `0x${"a".repeat(64)}`;
const prescriptionId = `0x${"b".repeat(64)}`;

function wallet(address = doctorAddress, chainId = "0x7a69") {
  return { request: async ({ method }) => method === "eth_accounts" ? [address] : chainId };
}

test("issue arguments match the deployed Solidity ABI order and types", () => {
  const iface = new Interface(registryAbi);
  const sourceIface = new Interface(deployedRegistryAbi.abi);
  for (const method of ["DOCTOR_ROLE", "PHARMACY_ROLE", "hasRole", "getPrescription", "verifyPatientHash", "issuePrescription", "revokePrescription", "verifyAndDispenseWithPatientHash"]) {
    assert.equal(iface.getFunction(method).format("sighash"), sourceIface.getFunction(method).format("sighash"), `${method} ABI signature must match the repository contract ABI`);
  }
  assert.deepEqual(iface.getFunction("issuePrescription").inputs.map((input) => input.type), ["bytes32", "bytes32", "string", "string", "uint256"]);
  assert.deepEqual(iface.getFunction("revokePrescription").inputs.map((input) => input.type), ["bytes32", "string"]);
  assert.deepEqual(iface.getFunction("verifyAndDispenseWithPatientHash").inputs.map((input) => input.type), ["bytes32", "bytes32"]);
  assert.deepEqual(iface.getFunction("getPrescription").inputs.map((input) => input.type), ["bytes32"]);
  assert.deepEqual(iface.getFunction("verifyPatientHash").inputs.map((input) => input.type), ["bytes32", "bytes32"]);
  assert.deepEqual(iface.getFunction("hasRole").inputs.map((input) => input.type), ["bytes32", "address"]);
  assert.deepEqual(iface.getFunction("getPrescription").outputs[0].components.map((field) => field.name), ["prescriptionId", "patientHash", "medicineId", "batchId", "doctorAddress", "issuedAt", "expiryTime", "status"]);
  const args = buildIssueArguments({
    doctorAddress,
    patientHash,
    medicineId: "MED-1",
    batchId: "BATCH-1",
    expiryDays: 30,
    nowMs: 1_700_000_000_000,
    nonce: "test-nonce",
  });
  const encoded = iface.encodeFunctionData("issuePrescription", args);
  assert.match(encoded, /^0x[0-9a-f]+$/);
  assert.equal(args[1], patientHash);
  assert.equal(args[2], "MED-1");
  assert.equal(args[3], "BATCH-1");
  assert.equal(args[4], 1_702_592_000n);
});

test("wallet context rejects wrong chain and changed account", async () => {
  await assert.rejects(assertWalletContext(wallet(doctorAddress, "0x1"), doctorAddress), /chain ID 31337/);
  await assert.rejects(assertWalletContext(wallet(pharmacyAddress), doctorAddress), /account changed/);
});

test("role check blocks the transaction call when the connected wallet lacks its role", async () => {
  let sent = false;
  const contract = {
    DOCTOR_ROLE: async () => "doctor-role",
    hasRole: async () => false,
    issuePrescription: async () => { sent = true; },
  };
  await assert.rejects(submitWalletTransaction({
    ethereum: wallet(),
    expectedAddress: doctorAddress,
    role: "doctor",
    method: "issuePrescription",
    args: [],
    contractFactory: async () => contract,
  }), /does not have the on-chain doctor role/);
  assert.equal(sent, false);
});

test("authorized wallet submits with its role and waits for confirmation", async () => {
  const events = [];
  const contract = {
    PHARMACY_ROLE: async () => "pharmacy-role",
    hasRole: async (_role, address) => address.toLowerCase() === pharmacyAddress.toLowerCase(),
    getPrescription: async () => ({ status: 0, expiryTime: BigInt(Math.floor(Date.now() / 1000) + 60) }),
    verifyPatientHash: async (id, hash) => id === prescriptionId && hash === patientHash,
    verifyAndDispenseWithPatientHash: async (...args) => {
      events.push(["send", ...args]);
      return { hash: "0xtx", wait: async () => { events.push(["wait"]); return { hash: "0xtx", blockNumber: 9, status: 1 }; } };
    },
  };
  const result = await submitWalletTransaction({
    ethereum: wallet(pharmacyAddress),
    expectedAddress: pharmacyAddress,
    role: "pharmacy",
    method: "verifyAndDispenseWithPatientHash",
    args: [prescriptionId, patientHash],
    contractFactory: async () => contract,
    preflight: (instance) => assertPatientHashMatches(instance, prescriptionId, patientHash),
    onPending: (hash) => events.push(["pending", hash]),
  });
  assert.deepEqual(events, [["send", prescriptionId, patientHash], ["pending", "0xtx"], ["wait"]]);
  assert.deepEqual(result, { transactionHash: "0xtx", blockNumber: 9 });
});

test("authorized wallet can resolve patient presentation arguments without persisting them", async () => {
  let sentArgs;
  const contract = {
    PHARMACY_ROLE: async () => "pharmacy-role",
    hasRole: async () => true,
    verifyAndDispenseWithPatientHash: async (...args) => {
      sentArgs = args;
      return { hash: "0xpresentation", wait: async () => ({ hash: "0xpresentation", blockNumber: 10, status: 1 }) };
    },
  };
  await submitWalletTransaction({
    ethereum: wallet(pharmacyAddress), expectedAddress: pharmacyAddress, role: "pharmacy",
    method: "verifyAndDispenseWithPatientHash",
    args: async () => [prescriptionId, patientHash],
    contractFactory: async () => contract,
  });
  assert.deepEqual(sentArgs, [prescriptionId, patientHash]);
});

test("wrong patient hash and non-issuer revocation are rejected before send", async () => {
  const active = { status: 0, expiryTime: BigInt(Math.floor(Date.now() / 1000) + 60) };
  await assert.rejects(assertPatientHashMatches({ getPrescription: async () => active, verifyPatientHash: async () => false }, prescriptionId, patientHash), /No transaction was sent/);
  await assert.rejects(assertWalletRole({ PHARMACY_ROLE: async () => "pharmacy", hasRole: async () => false }, pharmacyAddress, "pharmacy"), /does not have the on-chain pharmacy role/);
  assert.throws(() => assertPrescriptionIssuer({ doctorAddress: pharmacyAddress, status: 0 }, doctorAddress), /Only the doctor wallet/);
});

test("dispense preflight rejects replayed/used and expired prescriptions before sending", async () => {
  const hashMatches = async () => true;
  await assert.rejects(assertPatientHashMatches({
    getPrescription: async () => ({ status: 1, expiryTime: BigInt(Math.floor(Date.now() / 1000) + 60) }),
    verifyPatientHash: hashMatches,
  }, prescriptionId, patientHash), /not active/);
  await assert.rejects(assertPatientHashMatches({
    getPrescription: async () => ({ status: 0, expiryTime: BigInt(Math.floor(Date.now() / 1000) - 1) }),
    verifyPatientHash: hashMatches,
  }, prescriptionId, patientHash), /expired/);
});
