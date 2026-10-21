const hre = require("hardhat");
const addresses = require("../../../shared/blockchain/contract-addresses.json");

const BATCH_ID = "DEMO-SYNTH-2026-001";

async function main() {
  const [manufacturer] = await hre.ethers.getSigners();
  const address = addresses.localhost.MedicineTraceability;
  if (!address) throw new Error("MedicineTraceability is not configured for localhost.");

  const contract = await hre.ethers.getContractAt(
    "MedicineTraceability",
    address,
    manufacturer,
  );

  try {
    await contract.getBatch(BATCH_ID);
    console.log(JSON.stringify({ batchId: BATCH_ID, status: "already-registered" }, null, 2));
    return;
  } catch (error) {
    if (error?.revert?.name !== "BatchNotFound") throw error;
  }

  const latest = await hre.ethers.provider.getBlock("latest");
  const transaction = await contract.registerBatch({
    batchId: BATCH_ID,
    medicineId: "MED-AMOX-500",
    name: "Amoxicillin",
    category: "Antibiotic",
    dosageForm: "Tablet",
    strength: "500mg",
    manufacturerName: "MediSafe Labs",
    indication: "Bacterial infection",
    classification: "Prescription",
    quantity: 1000,
    manufacturedAt: latest.timestamp - 86400,
    expiresAt: latest.timestamp + 31536000,
    documentReference: "ipfs://bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    certificateReference: "ipfs://bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
  const receipt = await transaction.wait();
  console.log(JSON.stringify({
    batchId: BATCH_ID,
    contractAddress: address,
    transactionHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    status: "registered",
  }, null, 2));
}

main().catch((error) => {
  console.error(error.shortMessage || error.message);
  process.exitCode = 1;
});
