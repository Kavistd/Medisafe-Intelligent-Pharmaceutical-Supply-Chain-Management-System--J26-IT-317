const hre = require("hardhat");
const exportAbi = require("./export_pharmacy_trust_anchor_abi");

// Local research prototype only. Persistent or public networks need a separate,
// reviewed deployment decision with the Component 1 and Component 4 owners.
const SUPPORTED_NETWORKS = Object.freeze({ hardhat: 31337n, localhost: 31337n });

function address(runtime, value, label) {
  const { ethers } = runtime;
  if (typeof value !== "string" || !ethers.isAddress(value) || value === ethers.ZeroAddress) {
    throw new Error(`${label} must be a nonzero Ethereum address.`);
  }
  return ethers.getAddress(value);
}

/**
 * Deploy Component 3 PharmacyTrustAnchor.
 *   PHARMACY_TRUST_ANCHOR_ADMIN  optional admin (defaults to the deployer)
 *   PHARMACY_TRUST_ANCHORER      optional extra address granted ANCHORER_ROLE
 * Prints the deployed address. Never writes shared/blockchain/contract-addresses.json.
 */
async function main(options = {}) {
  const runtime = options.hre || hre;
  const env = options.env || process.env;
  const network = runtime.network.name;
  if (!(network in SUPPORTED_NETWORKS)) {
    throw new Error("PharmacyTrustAnchor deployment is limited to the hardhat and localhost networks.");
  }
  const { chainId } = await runtime.ethers.provider.getNetwork();
  if (chainId !== SUPPORTED_NETWORKS[network]) {
    throw new Error("Network chain ID does not match the selected network.");
  }

  const [deployer] = await runtime.ethers.getSigners();
  if (!deployer) throw new Error("No deployment signer configured.");
  const admin = address(runtime, env.PHARMACY_TRUST_ANCHOR_ADMIN || deployer.address, "PHARMACY_TRUST_ANCHOR_ADMIN");
  const anchorer = env.PHARMACY_TRUST_ANCHORER
    ? address(runtime, env.PHARMACY_TRUST_ANCHORER, "PHARMACY_TRUST_ANCHORER")
    : null;
  // Validate before sending any transaction: only the admin can grant roles.
  if (anchorer && anchorer !== admin && admin !== deployer.address) {
    throw new Error("PHARMACY_TRUST_ANCHORER can only be granted here when the deployer is the admin; grant it from the admin account instead.");
  }

  const anchor = await runtime.ethers.deployContract("PharmacyTrustAnchor", [admin], deployer);
  await anchor.waitForDeployment();
  const receipt = await anchor.deploymentTransaction().wait();
  const contractAddress = await anchor.getAddress();

  let grantTransactionHash = null;
  if (anchorer && anchorer !== admin) {
    const grant = await anchor.connect(deployer).grantRole(await anchor.ANCHORER_ROLE(), anchorer);
    grantTransactionHash = (await grant.wait()).hash;
  }

  if (options.exportAbi !== false) {
    await exportAbi({ hre: runtime, outputPath: options.abiPath });
  }

  const result = {
    network,
    contractAddress,
    admin,
    anchorer: anchorer || admin,
    transactionHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    grantTransactionHash,
    addressSaved: false,
  };
  if (!options.quiet) console.log(JSON.stringify(result, null, 2));
  return { anchor, ...result };
}

if (require.main === module) {
  main().catch(error => {
    // Only local networks are supported, but keep provider details out of logs.
    console.error(`PharmacyTrustAnchor deployment failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = main;
