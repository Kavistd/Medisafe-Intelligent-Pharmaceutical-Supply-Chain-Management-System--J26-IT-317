/**
 * Centralized Prescription Management Baseline Prototype
 * As specified in Section 3.3 of the Proposal Report.
 * Simulates a standard centralized electronic prescription database application
 * with application-level validation.
 */
class CentralizedPrescriptionDatabase {
  constructor() {
    this.prescriptions = new Map();
    this.auditLogs = [];
    this.doctors = new Set();
    this.pharmacies = new Set();
  }

  registerDoctor(doctorId) {
    this.doctors.add(doctorId.toLowerCase());
  }

  registerPharmacy(pharmacyId) {
    this.pharmacies.add(pharmacyId.toLowerCase());
  }

  issuePrescription({ doctorId, prescriptionId, patientHash, medicineId, batchId, expiryTime }) {
    const start = performance.now();
    const doc = doctorId.toLowerCase();
    if (!this.doctors.has(doc)) {
      throw new Error('UnauthorizedDoctor');
    }
    if (!prescriptionId || !patientHash) {
      throw new Error('InvalidInput');
    }
    if (this.prescriptions.has(prescriptionId)) {
      throw new Error('PrescriptionAlreadyExists');
    }
    const now = Math.floor(Date.now() / 1000);
    if (expiryTime <= now) {
      throw new Error('PrescriptionExpired');
    }

    const record = {
      prescriptionId,
      doctorId: doc,
      patientHash,
      medicineId,
      batchId,
      expiryTime,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now
    };

    this.prescriptions.set(prescriptionId, record);
    this.auditLogs.push({ action: 'ISSUE', prescriptionId, actor: doc, timestamp: now });
    const latencyMs = performance.now() - start;
    return { record, latencyMs };
  }

  dispensePrescription({ pharmacyId, prescriptionId, patientHash, externalRiskScore, externalTrustScore }) {
    const start = performance.now();
    const pharm = pharmacyId.toLowerCase();
    if (!this.pharmacies.has(pharm)) {
      throw new Error('UnauthorizedPharmacy');
    }
    const record = this.prescriptions.get(prescriptionId);
    if (!record) {
      throw new Error('PrescriptionNotFound');
    }
    if (record.status === 'USED') {
      throw new Error('PrescriptionAlreadyUsed');
    }
    if (record.status === 'REVOKED') {
      throw new Error('PrescriptionRevoked');
    }

    const now = Math.floor(Date.now() / 1000);
    if (record.expiryTime <= now) {
      record.status = 'EXPIRED';
      throw new Error('PrescriptionExpired');
    }

    if (patientHash && record.patientHash !== patientHash) {
      throw new Error('InvalidPatientHash');
    }

    // Cross-component simulation checks
    if (externalRiskScore !== undefined && externalRiskScore > 50) {
      throw new Error('HighMedicineRisk');
    }
    if (externalTrustScore !== undefined && externalTrustScore < 70) {
      throw new Error('LowPharmacyTrust');
    }

    record.status = 'USED';
    record.updatedAt = now;
    this.auditLogs.push({ action: 'DISPENSE', prescriptionId, actor: pharm, timestamp: now });
    const latencyMs = performance.now() - start;
    return { record, latencyMs };
  }

  revokePrescription({ doctorId, prescriptionId }) {
    const start = performance.now();
    const doc = doctorId.toLowerCase();
    const record = this.prescriptions.get(prescriptionId);
    if (!record) {
      throw new Error('PrescriptionNotFound');
    }
    if (record.doctorId !== doc) {
      throw new Error('UnauthorizedRevocation');
    }
    if (record.status !== 'ACTIVE') {
      throw new Error('PrescriptionNotActive');
    }

    const now = Math.floor(Date.now() / 1000);
    record.status = 'REVOKED';
    record.updatedAt = now;
    this.auditLogs.push({ action: 'REVOKE', prescriptionId, actor: doc, timestamp: now });
    const latencyMs = performance.now() - start;
    return { record, latencyMs };
  }

  getPrescription(prescriptionId) {
    const start = performance.now();
    const record = this.prescriptions.get(prescriptionId) || null;
    const latencyMs = performance.now() - start;
    return { record, latencyMs };
  }

  /**
   * Simulate concurrency race conditions on dispensing.
   * Demonstrates the difference between standard centralized database without serializable locks
   * and blockchain atomic EVM single-threaded state machine.
   */
  async simulateConcurrentDispense(pharmacyA, pharmacyB, prescriptionId, patientHash) {
    const record = this.prescriptions.get(prescriptionId);
    if (!record || record.status !== 'ACTIVE') {
      throw new Error('PrescriptionNotActive');
    }

    // Simulate concurrent reads before write
    let countSuccess = 0;
    const attempt = async (pharm) => {
      // Simulate realistic DB network latency
      await new Promise(r => setTimeout(r, Math.random() * 5 + 1));
      if (record.status === 'ACTIVE') {
        // vulnerable to race condition if not locked
        record.status = 'USED';
        countSuccess++;
      }
    };

    await Promise.all([attempt(pharmacyA), attempt(pharmacyB)]);
    return { doubleDispenseVulnerabilityOccurred: countSuccess > 1 };
  }
}

module.exports = { CentralizedPrescriptionDatabase };
