const { ethers } = require("hardhat");

/**
 * @notice Deploys the PrescriptionRegistry contract (Component 4)
 * @author R.A.M.A. Ranasinghe (IT23142978) - Component 4
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("==================================================");
  console.log("Deploying Component 4: PrescriptionRegistry");
  console.log("Deployer Address:", deployer.address);
  console.log("Deployer Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
  console.log("==================================================");

  // Address configuration from environment or fallback
  const riskRegistryAddress = process.env.CONTRACT_ADDRESS_RISK_REGISTRY || ethers.ZeroAddress;
  const pharmacyTrustAddress = process.env.CONTRACT_ADDRESS_PHARMACY_TRUST || ethers.ZeroAddress;

  console.log("Connecting Component 2 (Risk Registry):", riskRegistryAddress);
  console.log("Connecting Component 3 (Pharmacy Trust):", pharmacyTrustAddress);

  const PrescriptionRegistryFactory = await ethers.getContractFactory("PrescriptionRegistry");
  const prescriptionRegistry = await PrescriptionRegistryFactory.deploy(
    deployer.address,
    riskRegistryAddress,
    pharmacyTrustAddress
  );

  await prescriptionRegistry.waitForDeployment();
  const contractAddress = await prescriptionRegistry.getAddress();

  console.log("==================================================");
  console.log("SUCCESS: PrescriptionRegistry deployed to:", contractAddress);
  console.log("Transaction Hash:", prescriptionRegistry.deploymentTransaction().hash);
  console.log("==================================================");

  return { prescriptionRegistry, contractAddress };
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Deployment failed:", error);
      process.exit(1);
    });
}

module.exports = main;
