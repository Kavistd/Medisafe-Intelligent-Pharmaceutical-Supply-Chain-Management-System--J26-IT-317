const hre = require("hardhat");
const {
  address,
  checkNetwork,
  readAddresses,
  writeAddress,
  paths,
} = require("../lib/risk-registry");

/** Deploy Component 2 and record addresses only for persistent networks. */
async function main(options = {}) {
  const runtime = options.hre || hre;
  const env = options.env || process.env;
  const network = await checkNetwork(runtime, env);
  const [deployer] = await runtime.ethers.getSigners();
  if (!deployer) throw new Error("No deployment signer configured.");

  const configuredAdmin = env.RISK_REGISTRY_ADMIN;
  if (network === "sepolia" && !configuredAdmin) {
    throw new Error("RISK_REGISTRY_ADMIN must be explicitly configured for Sepolia.");
  }
  const admin = address(configuredAdmin || deployer.address, "RISK_REGISTRY_ADMIN");
  const addressesPath = options.addressesPath || paths.addresses;

  // Validate persistent configuration before constructing or sending a transaction.
  if (network !== "hardhat") readAddresses(addressesPath, network);

  const factory = await runtime.ethers.getContractFactory(
    "MedicineRiskRegistry",
    deployer
  );
  const registry = await factory.deploy(admin);
  await registry.waitForDeployment();
  const receipt = await registry.deploymentTransaction().wait();
  const contractAddress = await registry.getAddress();

  if (network !== "hardhat") {
    writeAddress(addressesPath, network, contractAddress);
  }

  if (!options.quiet) {
    console.log(
      JSON.stringify(
        {
          network,
          contractAddress,
          admin,
          transactionHash: receipt.hash,
          blockNumber: receipt.blockNumber,
          addressSaved: network !== "hardhat",
        },
        null,
        2
      )
    );
  }
  return { registry, contractAddress, admin, receipt };
}

if (require.main === module) {
  main().catch(() => {
    // Provider errors may include credential-bearing RPC URLs.
    console.error(
      "Risk registry deployment failed. Check network, signer, admin, funds " +
        "and configuration. If a transaction was sent, inspect the deployer " +
        "on-chain before retrying."
    );
    process.exitCode = 1;
  });
}

module.exports = main;
