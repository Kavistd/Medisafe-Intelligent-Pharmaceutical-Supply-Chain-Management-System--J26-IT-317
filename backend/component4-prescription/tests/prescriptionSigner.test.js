const assert = require("node:assert/strict");
const test = require("node:test");
const { ethers } = require("ethers");
const prescriptionService = require("../services/prescriptionService");
const { createConfiguredSigner } = prescriptionService;

const localAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

function provider(chainId = 31337n, accounts = [{ address: localAddress }]) {
  return {
    getNetwork: async () => ({ chainId }),
    listAccounts: async () => accounts,
  };
}

const localEnv = {
  NETWORK: "localhost",
  LOCAL_RPC_SIGNER: "true",
  BACKEND_SIGNER_ADDRESS: localAddress,
  // A malformed value confirms local mode never falls back to PRIVATE_KEY.
  PRIVATE_KEY: "must-not-be-used-in-local-mode",
};

test("local mode selects the configured unlocked JSON-RPC signer", async () => {
  const signer = await createConfiguredSigner(provider(), localEnv);
  assert.ok(signer instanceof ethers.JsonRpcSigner);
  assert.equal(await signer.getAddress(), ethers.getAddress(localAddress));
});

test("local mode rejects any RPC chain other than 31337", async () => {
  await assert.rejects(
    createConfiguredSigner(provider(31338n), localEnv),
    { code: "LOCAL_SIGNER_CHAIN_MISMATCH" }
  );
});

test("local mode rejects a missing signer address without private-key fallback", async () => {
  await assert.rejects(
    createConfiguredSigner(provider(), { ...localEnv, BACKEND_SIGNER_ADDRESS: "" }),
    { code: "LOCAL_SIGNER_ADDRESS_REQUIRED" }
  );
});

test("invalid local mode setting fails closed instead of selecting a private-key signer", async () => {
  await assert.rejects(
    createConfiguredSigner(provider(), { ...localEnv, LOCAL_RPC_SIGNER: "TRUE" }),
    { code: "LOCAL_SIGNER_CONFIGURATION_INVALID" }
  );
});

test("local mode rejects an address not exposed as unlocked by the RPC", async () => {
  await assert.rejects(
    createConfiguredSigner(provider(31337n, []), localEnv),
    { code: "LOCAL_SIGNER_NOT_UNLOCKED" }
  );
});

test("non-local configuration retains the private-key wallet signer", async () => {
  const wallet = ethers.Wallet.createRandom();
  const signer = await createConfiguredSigner(provider(), {
    NETWORK: "sepolia",
    LOCAL_RPC_SIGNER: "false",
    PRIVATE_KEY: wallet.privateKey,
  });
  assert.ok(signer instanceof ethers.Wallet);
  assert.equal(await signer.getAddress(), wallet.address);
});

test("backend service rejects all prescription writes and writable contract instances", async () => {
  assert.throws(prescriptionService.getContract, { code: "WALLET_TRANSACTION_REQUIRED" });
  await assert.rejects(prescriptionService.issuePrescription(), { code: "WALLET_TRANSACTION_REQUIRED" });
  await assert.rejects(prescriptionService.dispensePrescription(), { code: "WALLET_TRANSACTION_REQUIRED" });
  await assert.rejects(prescriptionService.revokePrescription(), { code: "WALLET_TRANSACTION_REQUIRED" });
});
