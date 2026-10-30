const assert = require("node:assert/strict");
const test = require("node:test");
const { getBlockchainStatus } = require("../services/prescriptionService");

const prescriptionRegistry = "0x0000000000000000000000000000000000000003";
const riskRegistry = "0x0000000000000000000000000000000000000004";

function dependencies({ chainId = 31337n, prescriptionCode = "0x6001", riskCode = "0x6002", riskAddress = riskRegistry } = {}) {
  return {
    provider: {
      getNetwork: async () => ({ chainId }),
      getCode: async (address) => address.toLowerCase() === prescriptionRegistry.toLowerCase() ? prescriptionCode : riskCode,
    },
    contract: {
      getAddress: async () => prescriptionRegistry,
      riskRegistry: async () => riskAddress,
    },
  };
}

test("blockchain readiness confirms chain 31337 and deployed Component 4 and Component 2 registries", async () => {
  const result = await getBlockchainStatus(dependencies());
  assert.deepEqual(result, {
    connected: true,
    chainId: 31337,
    prescriptionRegistry,
    riskRegistry,
    component3Connected: false,
  });
});

test("blockchain readiness rejects a wrong chain", async () => {
  await assert.rejects(getBlockchainStatus(dependencies({ chainId: 1n })), { code: "BLOCKCHAIN_CHAIN_MISMATCH", statusCode: 503 });
});

test("blockchain readiness fails safely when the RPC is unavailable", async () => {
  const deps = dependencies();
  deps.provider.getNetwork = async () => { throw new Error("provider diagnostic must not escape"); };
  await assert.rejects(getBlockchainStatus(deps), {
    code: "BLOCKCHAIN_RPC_UNAVAILABLE",
    statusCode: 503,
    message: "Unable to connect to the configured local blockchain RPC.",
  });
});

test("blockchain readiness rejects missing Component 4 bytecode", async () => {
  await assert.rejects(getBlockchainStatus(dependencies({ prescriptionCode: "0x" })), { code: "PRESCRIPTION_REGISTRY_UNAVAILABLE", statusCode: 503 });
});

test("blockchain readiness rejects an unconfigured Component 2 registry", async () => {
  await assert.rejects(getBlockchainStatus(dependencies({ riskAddress: "0x0000000000000000000000000000000000000000" })), { code: "RISK_REGISTRY_NOT_CONFIGURED", statusCode: 503 });
});

test("blockchain readiness rejects missing Component 2 bytecode", async () => {
  await assert.rejects(getBlockchainStatus(dependencies({ riskCode: "0x" })), { code: "RISK_REGISTRY_UNAVAILABLE", statusCode: 503 });
});

test("blockchain readiness fails safely when the Component 4 riskRegistry read fails", async () => {
  const deps = dependencies();
  deps.contract.riskRegistry = async () => { throw new Error("provider diagnostic must not escape"); };
  await assert.rejects(getBlockchainStatus(deps), {
    code: "BLOCKCHAIN_REGISTRY_CHECK_FAILED",
    statusCode: 503,
    message: "Unable to verify the deployed Component 4 and Component 2 registries.",
  });
});
