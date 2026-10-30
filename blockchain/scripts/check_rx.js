const addresses = require('../../shared/blockchain/contract-addresses.json');

async function main() {
  const contract = await ethers.getContractAt('PrescriptionRegistry', addresses.localhost.PrescriptionRegistry);
  const rxId1 = '0xbaba42f77de88461bfd6518a396a825104bec7686680982a0f13612e8af8be50';
  const rx = await contract.getPrescription(rxId1);
  console.log('PATIENT_HASH_IS:', rx.patientHash);
  console.log('STATUS_IS:', rx.status.toString());
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
