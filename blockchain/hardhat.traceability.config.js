// Opt-in Component 1 network configuration; the shared base config is unchanged.
const base = require("./hardhat.config");
const privateKey = process.env.PRIVATE_KEY;
if (privateKey && !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error("PRIVATE_KEY must be a 0x-prefixed 32-byte key; its value is not logged.");
}
const sepolia = process.env.RPC_URL ? {
  sepolia: {
    url: process.env.RPC_URL,
    chainId: 11155111,
    accounts: privateKey ? [privateKey] : [],
  },
} : {};

module.exports = {
  ...base,
  networks: { ...base.networks, ...sepolia },
};
