const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const paths = {
  addresses: path.resolve(__dirname, "../../../shared/blockchain/contract-addresses.json"),
  abi: path.resolve(__dirname, "../../../shared/abis/MedicineTraceability.json"),
};

function address(value, label) {
  if (typeof value !== "string" || !ethers.isAddress(value) || value === ethers.ZeroAddress)
    throw new Error(`${label} must be a nonzero Ethereum address.`);
  return ethers.getAddress(value);
}

async function checkNetwork(hre, env) {
  const name = hre.network.name;
  const expected = { hardhat: 31337n, localhost: 31337n, sepolia: 11155111n };
  if (!(name in expected)) throw new Error("Unsupported traceability deployment network.");
  if (name === "sepolia" && env.TRACEABILITY_ALLOW_SEPOLIA !== "true")
    throw new Error("Sepolia requires explicit approval and TRACEABILITY_ALLOW_SEPOLIA=true.");
  const { chainId } = await hre.ethers.provider.getNetwork();
  if (chainId !== expected[name]) throw new Error("Network chain ID does not match the selected network.");
  return name;
}

function readAddresses(file, network) {
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!config[network] || typeof config[network] !== "object" || Array.isArray(config[network]) ||
      typeof config[network].MedicineTraceability !== "string")
    throw new Error("Missing MedicineTraceability network address slot.");
  return config;
}

function writeAddress(file, network, deployedAddress) {
  if (network !== "localhost" && network !== "sepolia") throw new Error("Only persistent supported networks may be recorded.");
  const config = readAddresses(file, network);
  config[network].MedicineTraceability = address(deployedAddress, "Deployed address");
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
}

module.exports = { address, checkNetwork, readAddresses, writeAddress, paths };
