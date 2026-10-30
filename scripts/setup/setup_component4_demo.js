const path = require("path");
const fs = require("fs");

/**
 * Setup script for Component 4 (Prescription Management)
 * Configures the user's updated MetaMask accounts:
 * - Account 1: 0x2a13ee1f4C69386864A271Bceb401fcd3d91c942 (Doctor)
 * - Account 2: 0x2376C6970c55AB66c4FFcad53A49fb21f862B613 (Pharmacy / Patient)
 * - Account 3: 0x7465C8b4C7a9068c440044222539f993bf4537A7 (Pharmacy / Patient)
 * - Account 4: 0xd2F150C082261e31F7504f129C799218186C4701 (Admin)
 *
 * Usage:
 * From blockchain/ directory:
 * npx hardhat run ../scripts/setup/setup_component4_demo.js --network localhost
 */

const TARGET_ACCOUNTS = {
  account1: "0x2a13ee1f4C69386864A271Bceb401fcd3d91c942",
  account2: "0x2376C6970c55AB66c4FFcad53A49fb21f862B613",
  account3: "0x7465C8b4C7a9068c440044222539f993bf4537A7",
  account4: "0xd2F150C082261e31F7504f129C799218186C4701",
};

async function main() {
  let hre;
  try {
    hre = require("hardhat");
  } catch {
    hre = require("../../blockchain/node_modules/hardhat");
  }
  const { ethers } = hre;

  console.log("==================================================");
  console.log("Configuring Updated Accounts for Component 4");
  console.log("Network:", hre.network.name, "(Chain ID: 31337)");
  console.log("==================================================");

  const signers = await ethers.getSigners();
  const deployer = signers[0];

  console.log("Hardhat Deployer Account:", deployer.address);
  console.log("Account 1 (Doctor):  ", TARGET_ACCOUNTS.account1);
  console.log("Account 2 (Pharmacy):", TARGET_ACCOUNTS.account2);
  console.log("Account 3 (Patient): ", TARGET_ACCOUNTS.account3);
  console.log("Account 4 (Admin):   ", TARGET_ACCOUNTS.account4);

  // 1. Fund all 4 accounts with 50 ETH each
  console.log("\n[1] Ensuring all accounts have at least 50 ETH...");
  for (const [label, address] of Object.entries(TARGET_ACCOUNTS)) {
    const bal = await ethers.provider.getBalance(address);
    if (bal < ethers.parseEther("10.0")) {
      const fundTx = await deployer.sendTransaction({
        to: address,
        value: ethers.parseEther("50.0")
      });
      await fundTx.wait();
      console.log(`✓ Funded 50 ETH to ${label} (${address})`);
    } else {
      console.log(`✓ ${label} (${address}) has ${ethers.formatEther(bal)} ETH`);
    }
  }

  // Load existing deployed addresses or deploy if needed
  const addressesPath = path.resolve(__dirname, "../../shared/blockchain/contract-addresses.json");
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
  let prescriptionAddress = addresses.localhost?.PrescriptionRegistry;
  let riskAddress = addresses.localhost?.MedicineRiskRegistry;
  let trustAddress = addresses.localhost?.PharmacyTrust;

  let prescriptionRegistry, riskRegistry, pharmacyTrust;

  if (prescriptionAddress && (await ethers.provider.getCode(prescriptionAddress)) !== "0x") {
    console.log("\nUsing already deployed contracts on running node:");
    prescriptionRegistry = await ethers.getContractAt("PrescriptionRegistry", prescriptionAddress, deployer);
    riskRegistry = await ethers.getContractAt("MedicineRiskRegistry", riskAddress, deployer);
    pharmacyTrust = await ethers.getContractAt("PharmacyTrust", trustAddress, deployer);
  } else {
    console.log("\nDeploying fresh contracts...");
    const RiskRegistryFactory = await ethers.getContractFactory("MedicineRiskRegistry");
    riskRegistry = await RiskRegistryFactory.deploy(deployer.address);
    await riskRegistry.waitForDeployment();
    riskAddress = await riskRegistry.getAddress();

    const PharmacyTrustFactory = await ethers.getContractFactory("PharmacyTrust");
    pharmacyTrust = await PharmacyTrustFactory.deploy(deployer.address);
    await pharmacyTrust.waitForDeployment();
    trustAddress = await pharmacyTrust.getAddress();

    const PrescriptionRegistryFactory = await ethers.getContractFactory("PrescriptionRegistry");
    prescriptionRegistry = await PrescriptionRegistryFactory.deploy(deployer.address, riskAddress, trustAddress);
    await prescriptionRegistry.waitForDeployment();
    prescriptionAddress = await prescriptionRegistry.getAddress();

    addresses.localhost.PrescriptionRegistry = prescriptionAddress;
    addresses.localhost.MedicineRiskRegistry = riskAddress;
    addresses.localhost.PharmacyTrust = trustAddress;
    addresses.hardhat.PrescriptionRegistry = prescriptionAddress;
    addresses.hardhat.MedicineRiskRegistry = riskAddress;
    addresses.hardhat.PharmacyTrust = trustAddress;
    fs.writeFileSync(addressesPath, JSON.stringify(addresses, null, 2) + "\n", "utf8");
  }

  console.log("PrescriptionRegistry:", prescriptionAddress);
  console.log("MedicineRiskRegistry:", riskAddress);
  console.log("PharmacyTrust:       ", trustAddress);

  // Grant Roles
  const DOCTOR_ROLE = await prescriptionRegistry.DOCTOR_ROLE();
  const PHARMACY_ROLE = await prescriptionRegistry.PHARMACY_ROLE();
  const DEFAULT_ADMIN_ROLE = await prescriptionRegistry.DEFAULT_ADMIN_ROLE();

  console.log("\n[2] Granting Roles to Accounts...");
  // Grant Doctor to Account 1
  await (await prescriptionRegistry.grantRole(DOCTOR_ROLE, TARGET_ACCOUNTS.account1)).wait();
  console.log(`✓ Granted DOCTOR_ROLE to Account 1 (${TARGET_ACCOUNTS.account1})`);

  // Grant Pharmacy to BOTH Account 2 and Account 3 so user can use either as pharmacy
  await (await prescriptionRegistry.grantRole(PHARMACY_ROLE, TARGET_ACCOUNTS.account2)).wait();
  await (await pharmacyTrust.setPharmacyTrust(TARGET_ACCOUNTS.account2, 95, true)).wait();
  console.log(`✓ Granted PHARMACY_ROLE & Trust Score 95 to Account 2 (${TARGET_ACCOUNTS.account2})`);

  await (await prescriptionRegistry.grantRole(PHARMACY_ROLE, TARGET_ACCOUNTS.account3)).wait();
  await (await pharmacyTrust.setPharmacyTrust(TARGET_ACCOUNTS.account3, 95, true)).wait();
  console.log(`✓ Granted PHARMACY_ROLE & Trust Score 95 to Account 3 (${TARGET_ACCOUNTS.account3})`);

  // Grant Admin to Account 4
  await (await prescriptionRegistry.grantRole(DEFAULT_ADMIN_ROLE, TARGET_ACCOUNTS.account4)).wait();
  console.log(`✓ Granted DEFAULT_ADMIN_ROLE to Account 4 (${TARGET_ACCOUNTS.account4})`);

  console.log("\n==================================================");
  console.log("Account Updates Complete!");
  console.log("==================================================");
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = main;
