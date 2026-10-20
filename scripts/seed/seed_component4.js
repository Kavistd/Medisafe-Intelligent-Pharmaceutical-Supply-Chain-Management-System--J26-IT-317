const path = require("path");
const fs = require("fs");

/**
 * Seeding script for Component 4
 * Seeds Component 2 batch risk assessments, Component 3 pharmacy trust scores,
 * and issues initial demo prescriptions.
 *
 * Accounts:
 * - Account 1 (Doctor):   0x2a13ee1f4C69386864A271Bceb401fcd3d91c942
 * - Account 2 (Pharmacy): 0x2376C6970c55AB66c4FFcad53A49fb21f862B613
 * - Account 3 (Patient):  0x7465C8b4C7a9068c440044222539f993bf4537A7
 * - Account 4 (Admin):    0xd2F150C082261e31F7504f129C799218186C4701
 *
 * Usage:
 * From blockchain/ directory:
 * npx hardhat run ../scripts/seed/seed_component4.js --network localhost
 */

const TARGET_ACCOUNTS = {
  doctor: "0x2a13ee1f4C69386864A271Bceb401fcd3d91c942",
  pharmacy: "0x2376C6970c55AB66c4FFcad53A49fb21f862B613",
  patient: "0x7465C8b4C7a9068c440044222539f993bf4537A7",
  admin: "0xd2F150C082261e31F7504f129C799218186C4701",
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
  console.log("Seeding Component 4 Multi-Layer Data");
  console.log("Network:", hre.network.name);
  console.log("==================================================");

  const addressesPath = path.resolve(__dirname, "../../shared/blockchain/contract-addresses.json");
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
  const net = hre.network.name === "localhost" ? "localhost" : "hardhat";

  const prescriptionAddress = addresses[net]?.PrescriptionRegistry;
  const riskAddress = addresses[net]?.MedicineRiskRegistry;
  const trustAddress = addresses[net]?.PharmacyTrust;

  const signers = await ethers.getSigners();
  const adminSigner = signers[0];

  const riskRegistry = await ethers.getContractAt("MedicineRiskRegistry", riskAddress, adminSigner);
  const pharmacyTrust = await ethers.getContractAt("PharmacyTrust", trustAddress, adminSigner);

  // 1. Seed Component 2 Batches
  console.log("\n[1] Seeding Component 2 Batch Risk Assessments...");
  await (await riskRegistry.setBatchRisk("BATCH-SAFE-001", 15, true)).wait();
  console.log("✓ Seeded BATCH-SAFE-001: Risk Score = 15, isSafe = true (Safe for dispensing)");

  await (await riskRegistry.setBatchRisk("BATCH-RISK-002", 88, false)).wait();
  console.log("✓ Seeded BATCH-RISK-002: Risk Score = 88, isSafe = false (Counterfeit / High Risk)");

  // 2. Seed Component 3 Pharmacy Trust
  console.log("\n[2] Seeding Component 3 Pharmacy Trust Scores...");
  await (await pharmacyTrust.setPharmacyTrust(TARGET_ACCOUNTS.pharmacy, 95, true)).wait();
  await (await pharmacyTrust.setPharmacyTrust(TARGET_ACCOUNTS.patient, 95, true)).wait();
  console.log(`✓ Seeded Pharmacy trust for ${TARGET_ACCOUNTS.pharmacy} and ${TARGET_ACCOUNTS.patient}`);

  // 3. Issue Demo Prescriptions from Account 1 (Doctor)
  console.log(`\n[3] Issuing Demo Prescriptions from Doctor (${TARGET_ACCOUNTS.doctor})...`);
  try {
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [TARGET_ACCOUNTS.doctor]
    });
  } catch {}

  const doctorSigner = await ethers.getSigner(TARGET_ACCOUNTS.doctor);
  const prescriptionRegistry = await ethers.getContractAt("PrescriptionRegistry", prescriptionAddress, doctorSigner);

  const block = await ethers.provider.getBlock("latest");
  const expiryTime = block.timestamp + 86400 * 30; // 30 days

  const mockPatientHash = ethers.keccak256(ethers.toUtf8Bytes("PATIENT-DEMO-2026-IT23142978"));
  const rxId1 = ethers.keccak256(ethers.toUtf8Bytes("RX-DEMO-SAFE-001"));
  const rxId2 = ethers.keccak256(ethers.toUtf8Bytes("RX-DEMO-RISK-002"));

  try {
    const tx1 = await prescriptionRegistry.issuePrescription(
      rxId1,
      mockPatientHash,
      "MED-AMOXICILLIN-500",
      "BATCH-SAFE-001",
      expiryTime
    );
    await tx1.wait();
    console.log(`✓ Issued RX-DEMO-SAFE-001 (ID: ${rxId1}) bound to BATCH-SAFE-001`);
  } catch (err) {
    if (err.message.includes("PrescriptionAlreadyExists")) {
      console.log("! RX-DEMO-SAFE-001 already exists, skipping issuance.");
    } else {
      console.warn("Notice on issuance:", err.message);
    }
  }

  try {
    const tx2 = await prescriptionRegistry.issuePrescription(
      rxId2,
      mockPatientHash,
      "MED-PARACETAMOL-500",
      "BATCH-RISK-002",
      expiryTime
    );
    await tx2.wait();
    console.log(`✓ Issued RX-DEMO-RISK-002 (ID: ${rxId2}) bound to BATCH-RISK-002`);
  } catch (err) {
    if (err.message.includes("PrescriptionAlreadyExists")) {
      console.log("! RX-DEMO-RISK-002 already exists, skipping issuance.");
    } else {
      console.warn("Notice on issuance:", err.message);
    }
  }

  console.log("\n==================================================");
  console.log("Component 4 Data Seeding Complete!");
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
