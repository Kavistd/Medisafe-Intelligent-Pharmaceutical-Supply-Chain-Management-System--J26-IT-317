const hre = require("hardhat");
const { address, checkNetwork, readAddresses, writeAddress, paths } = require("../lib/traceability");
const exportAbi = require("./export_traceability_abi");

/** Deploy only Component 1; never publish ephemeral Hardhat addresses. */
async function main(options = {}) {
  const runtime = options.hre || hre;
  const env = options.env || process.env;
  const network = await checkNetwork(runtime, env);
  const [deployer] = await runtime.ethers.getSigners();
  if (!deployer) throw new Error("No deployment signer configured.");
  const admin = address(env.TRACEABILITY_ADMIN || (network === "sepolia" ? "" : deployer.address), "TRACEABILITY_ADMIN");
  const addressesPath = options.addressesPath || paths.addresses;
  // Validate the existing configuration before spending gas.
  if (network !== "hardhat") readAddresses(addressesPath, network);
  const factory = await runtime.ethers.getContractFactory("MedicineTraceability", deployer);
  const traceability = await factory.deploy(admin);
  await traceability.waitForDeployment();
  const receipt = await traceability.deploymentTransaction().wait();
  const contractAddress = await traceability.getAddress();
  if (network !== "hardhat") writeAddress(addressesPath, network, contractAddress);
  await exportAbi({ hre: runtime, outputPath: options.abiPath || paths.abi });
  if (!options.quiet) {
    console.log(JSON.stringify({ network, contractAddress, admin, transactionHash: receipt.hash, blockNumber: receipt.blockNumber, addressSaved: network !== "hardhat" }, null, 2));
  }
  return { traceability, contractAddress, admin, receipt };
}

if (require.main === module) main().catch(() => {
  // Provider errors may contain credential-bearing RPC URLs. Do not print them.
  console.error("Traceability deployment failed. Check network, signer, admin, funds and configuration. If a transaction was sent, inspect the deployer on-chain before retrying.");
  process.exitCode = 1;
});

module.exports = main;
