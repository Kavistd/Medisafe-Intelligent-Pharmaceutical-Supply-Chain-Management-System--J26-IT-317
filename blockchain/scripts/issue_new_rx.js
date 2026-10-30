const addresses = require('../../shared/blockchain/contract-addresses.json');

async function main() {
  const doctorAddress = "0x2a13ee1f4C69386864A271Bceb401fcd3d91c942";
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [doctorAddress]
  });
  const doctor = await ethers.getSigner(doctorAddress);
  const contract = await ethers.getContractAt('PrescriptionRegistry', addresses.localhost.PrescriptionRegistry, doctor);
  const rxId = ethers.keccak256(ethers.toUtf8Bytes('RX-PATIENT-FLOW-001'));
  const patientHash = '0x30f7804c2ed96c752fd1cbea1c337bf92af7cec72e6c5c9794ccfa0c2f852c6c';
  const block = await ethers.provider.getBlock('latest');
  const expiry = block.timestamp + 30 * 86400;
  try {
    const tx = await contract.issuePrescription(rxId, patientHash, 'MED-AMOX-500', 'BATCH-SAFE-001', expiry);
    await tx.wait();
    console.log('ISSUED_NEW_RX_ID:', rxId);
  } catch (err) {
    if (err.message.includes('PrescriptionAlreadyExists')) {
      console.log('ISSUED_NEW_RX_ID:', rxId);
    } else {
      throw err;
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
