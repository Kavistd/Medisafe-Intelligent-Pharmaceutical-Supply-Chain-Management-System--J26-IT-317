const assert = require('node:assert/strict');

// Characterize existing integration behavior without changing any component.
// These extra fixture transactions are excluded from Component 1 metrics.
async function checkCrossComponent(hre, traceability, { admin, pharmacy }, replica) {
  const risk = await (await hre.ethers.getContractFactory('MedicineRiskRegistry')).deploy(admin.address); await risk.waitForDeployment();
  const trust = await (await hre.ethers.getContractFactory('PharmacyTrust')).deploy(admin.address); await trust.waitForDeployment();
  const prescriptions = await (await hre.ethers.getContractFactory('PrescriptionRegistry')).deploy(admin.address, await risk.getAddress(), await trust.getAddress()); await prescriptions.waitForDeployment();
  await (await prescriptions.grantRole(await prescriptions.DOCTOR_ROLE(), admin.address)).wait();
  await (await prescriptions.grantRole(await prescriptions.PHARMACY_ROLE(), pharmacy.address)).wait();
  await (await trust.setPharmacyTrust(pharmacy.address, 95, true)).wait();
  const observations = [];
  const suffix = String(replica).padStart(3, '0');
  const patientHash = hre.ethers.id('SYNTHETIC-NOT-A-PATIENT-IDENTITY');
  async function issue(id, batchId) {
    const now = (await hre.ethers.provider.getBlock('latest')).timestamp;
    await (await prescriptions.issuePrescription(id, patientHash, 'SYNTHETIC-MED', batchId, now + 3600)).wait();
  }
  for (const [condition, batchId] of [['recalled', 'RECL-' + suffix], ['expired', 'EXPR-' + suffix]]) {
    const record = await traceability.getBatch(batchId);
    assert.equal(condition === 'recalled' ? record.recalled : await traceability.isBatchExpired(batchId), true);
    await (await risk.setBatchRisk(batchId, 10, true)).wait();
    const id = hre.ethers.id('EVALUATION-' + condition); await issue(id, batchId);
    const receipt = await (await prescriptions.connect(pharmacy).verifyAndDispenseWithPatientHash(id, patientHash)).wait();
    assert.equal(Number(receipt.status), 1); assert.equal(Number((await prescriptions.getPrescription(id)).status), 1);
    observations.push({ condition, batchId, traceabilityInvalid: true, dispensingSucceeded: true, transactionHash: receipt.hash });
  }
  const rejected = async (id, expected) => {
    let actual;
    try { await prescriptions.connect(pharmacy).verifyAndDispenseWithPatientHash.staticCall(id, patientHash); }
    catch (error) { actual = prescriptions.interface.parseError(error.data)?.name; }
    assert.equal(actual, expected); return actual;
  };
  const unsafeId = hre.ethers.id('EVALUATION-UNSAFE'); await (await risk.setBatchRisk('UNSAFE', 100, false)).wait(); await issue(unsafeId, 'UNSAFE');
  const riskControl = await rejected(unsafeId, 'HighMedicineRisk');
  const missingId = hre.ethers.id('EVALUATION-MISSING'); await issue(missingId, 'MISSING');
  const missingControl = await rejected(missingId, 'RiskRecordNotFound');
  await (await trust.setPharmacyTrust(pharmacy.address, 5, false)).wait();
  const trustId = hre.ethers.id('EVALUATION-LOW-TRUST'); await issue(trustId, 'RECL-' + suffix);
  const trustControl = await rejected(trustId, 'LowPharmacyTrust');
  return { name: 'cross_component_contracts', passed: true, recallExpiryPropagationGap: true, observations,
    controls: { unsafeRisk: riskControl, missingRisk: missingControl, lowTrust: trustControl },
    detail: 'Real local Component 2/3/4 contracts with manually seeded risk/trust; no AI inference. Legacy Component 4 dispenses invalid Component 1 batches because it has no traceability link. Expected gap observations are excluded from Component 1 enforcement accuracy.' };
}
module.exports = { checkCrossComponent };
