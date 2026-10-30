// Opt-in Component 2 network configuration; the shared base config is unchanged.
const base = require("./hardhat.config");

const privateKey =
  process.env.RISK_REGISTRY_PRIVATE_KEY || process.env.PRIVATE_KEY;
if (privateKey && !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error(
    "RISK_REGISTRY_PRIVATE_KEY must be a 0x-prefixed 32-byte key; its value is not logged."
  );
}

const rpcUrl = process.env.WEB3_RPC_URL || process.env.RPC_URL;
const sepolia = rpcUrl
  ? {
      sepolia: {
        url: rpcUrl,
        chainId: 11155111,
        accounts: privateKey ? [privateKey] : [],
      },
    }
  : {};

module.exports = {
  ...base,
  networks: { ...base.networks, ...sepolia },
};
