const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const path = require("path");

// Import client-side privacy utility
const {
  hashPatientIdentity,
  generateSalt,
  verifyPatientIdentity,
  generatePrescriptionId,
  createPrescriptionPayload,
} = require("../../src/utils/privacy");

describe("Component 4: PrescriptionRegistry (Privacy-Preserving Blockchain Prescription Management)", function () {
  let prescriptionRegistry;
  let mockRiskRegistry;
  let mockPharmacyTrust;
  let owner, doctor, pharmacy, untrustedPharmacy, patient, unauthorizedUser;

  const MEDICINE_ID = "MED-AMOX-500";
  const BATCH_ID = "BATCH-2026-X01";
  const SAFE_RISK_SCORE = 15;
  const HIGH_RISK_SCORE = 85;
  const HIGH_TRUST_SCORE = 95;
  const LOW_TRUST_SCORE = 30;

  let patientIdentity;
  let salt;
  let patientHash;
  let prescriptionId;
  let validExpiryTime;

  beforeEach(async function () {
    [owner, doctor, pharmacy, untrustedPharmacy, patient, unauthorizedUser] =
      await ethers.getSigners();

    // 1. Deploy Component 2 Mock (MedicineRiskRegistry)
    const RiskRegistryFactory = await ethers.getContractFactory("MedicineRiskRegistry");
    mockRiskRegistry = await RiskRegistryFactory.deploy(owner.address);
    await mockRiskRegistry.waitForDeployment();

    // 2. Deploy Component 3 Mock (PharmacyTrust)
    const PharmacyTrustFactory = await ethers.getContractFactory("PharmacyTrust");
    mockPharmacyTrust = await PharmacyTrustFactory.deploy(owner.address);
    await mockPharmacyTrust.waitForDeployment();

    // Configure initial mock oracle states
    await mockRiskRegistry.setBatchRisk(BATCH_ID, SAFE_RISK_SCORE, true);
    await mockPharmacyTrust.setPharmacyTrust(pharmacy.address, HIGH_TRUST_SCORE, true);
    await mockPharmacyTrust.setPharmacyTrust(untrustedPharmacy.address, LOW_TRUST_SCORE, false);

    // 3. Deploy Component 4 (PrescriptionRegistry)
    const PrescriptionRegistryFactory = await ethers.getContractFactory("PrescriptionRegistry");
    prescriptionRegistry = await PrescriptionRegistryFactory.deploy(
      owner.address,
      await mockRiskRegistry.getAddress(),
      await mockPharmacyTrust.getAddress()
    );
    await prescriptionRegistry.waitForDeployment();

    // 4. Assign Roles via OpenZeppelin AccessControl
    const DOCTOR_ROLE = await prescriptionRegistry.DOCTOR_ROLE();
    const PHARMACY_ROLE = await prescriptionRegistry.PHARMACY_ROLE();

    await prescriptionRegistry.grantRole(DOCTOR_ROLE, doctor.address);
    await prescriptionRegistry.grantRole(PHARMACY_ROLE, pharmacy.address);
    await prescriptionRegistry.grantRole(PHARMACY_ROLE, untrustedPharmacy.address);

    // 5. Generate client-side off-chain patient identity hash
    patientIdentity = {
      nationalId: "NIC-199584920193",
      fullName: "Jane Doe",
      dateOfBirth: "1995-04-12",
    };
    salt = generateSalt();
    patientHash = hashPatientIdentity(patientIdentity, salt);
    prescriptionId = ethers.keccak256(ethers.toUtf8Bytes("PRESCRIPTION-UUID-2026-001"));

    const latestTime = await time.latest();
    validExpiryTime = latestTime + 30 * 24 * 3600; // 30 days validity
  });

  describe("1. Access Control and Deployment Setup", function () {
    it("Should grant DEFAULT_ADMIN_ROLE to deployer", async function () {
      const DEFAULT_ADMIN_ROLE = await prescriptionRegistry.DEFAULT_ADMIN_ROLE();
      expect(await prescriptionRegistry.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
    });

    it("Should assign DOCTOR_ROLE and PHARMACY_ROLE correctly", async function () {
      const DOCTOR_ROLE = await prescriptionRegistry.DOCTOR_ROLE();
      const PHARMACY_ROLE = await prescriptionRegistry.PHARMACY_ROLE();

      expect(await prescriptionRegistry.hasRole(DOCTOR_ROLE, doctor.address)).to.be.true;
      expect(await prescriptionRegistry.hasRole(PHARMACY_ROLE, pharmacy.address)).to.be.true;
      expect(await prescriptionRegistry.hasRole(DOCTOR_ROLE, unauthorizedUser.address)).to.be.false;
      expect(await prescriptionRegistry.hasRole(PHARMACY_ROLE, unauthorizedUser.address)).to.be.false;
    });

    it("Should properly configure external registry addresses", async function () {
      expect(await prescriptionRegistry.riskRegistry()).to.equal(await mockRiskRegistry.getAddress());
      expect(await prescriptionRegistry.pharmacyTrustRegistry()).to.equal(await mockPharmacyTrust.getAddress());
    });
  });

  describe("2. Client-Side Privacy and Hashing (src/utils/privacy.js)", function () {
    it("Should generate deterministic Keccak-256 patientHash for identical input and salt", function () {
      const hash1 = hashPatientIdentity(patientIdentity, salt);
      const hash2 = hashPatientIdentity(patientIdentity, salt);
      expect(hash1).to.equal(hash2);
      expect(hash1).to.match(/^0x[0-9a-fA-F]{64}$/);
    });

    it("Should generate completely distinct hashes when salt differs (anti-rainbow table)", function () {
      const altSalt = generateSalt();
      const hash1 = hashPatientIdentity(patientIdentity, salt);
      const hash2 = hashPatientIdentity(patientIdentity, altSalt);
      expect(hash1).to.not.equal(hash2);
    });

    it("Should correctly verify patient identity off-chain", function () {
      expect(verifyPatientIdentity(patientIdentity, salt, patientHash)).to.be.true;
      expect(verifyPatientIdentity("wrong-patient-data", salt, patientHash)).to.be.false;
    });

    it("Should generate a valid prescription creation bundle via createPrescriptionPayload", function () {
      const payload = createPrescriptionPayload({
        identityData: patientIdentity,
        medicineId: MEDICINE_ID,
        batchId: BATCH_ID,
        doctorAddress: doctor.address,
        expiryDays: 14,
      });

      expect(payload.onChainData.prescriptionId).to.match(/^0x[0-9a-fA-F]{64}$/);
      expect(payload.onChainData.patientHash).to.match(/^0x[0-9a-fA-F]{64}$/);
      expect(payload.onChainData.medicineId).to.equal(MEDICINE_ID);
      expect(payload.onChainData.batchId).to.equal(BATCH_ID);
      expect(payload.offChainPrivateData.salt).to.match(/^0x[0-9a-fA-F]{64}$/);
    });
  });

  describe("3. Valid Prescription Issuance", function () {
    it("Should allow an authorized doctor to issue a prescription", async function () {
      const tx = await prescriptionRegistry
        .connect(doctor)
        .issuePrescription(prescriptionId, patientHash, MEDICINE_ID, BATCH_ID, validExpiryTime);

      await expect(tx)
        .to.emit(prescriptionRegistry, "PrescriptionIssued")
        .withArgs(
          prescriptionId,
          patientHash,
          MEDICINE_ID,
          BATCH_ID,
          doctor.address,
          validExpiryTime,
          await time.latest()
        );

      const rx = await prescriptionRegistry.getPrescription(prescriptionId);
      expect(rx.prescriptionId).to.equal(prescriptionId);
      expect(rx.patientHash).to.equal(patientHash);
      expect(rx.medicineId).to.equal(MEDICINE_ID);
      expect(rx.batchId).to.equal(BATCH_ID);
      expect(rx.doctorAddress).to.equal(doctor.address);
      expect(rx.expiryTime).to.equal(validExpiryTime);
      expect(rx.status).to.equal(0); // ACTIVE

      expect(await prescriptionRegistry.verifyPatientHash(prescriptionId, patientHash)).to.be.true;
      expect(await prescriptionRegistry.getTotalPrescriptions()).to.equal(1);
    });

    it("Should prevent duplicate prescription issuance with existing prescriptionId", async function () {
      await prescriptionRegistry
        .connect(doctor)
        .issuePrescription(prescriptionId, patientHash, MEDICINE_ID, BATCH_ID, validExpiryTime);

      await expect(
        prescriptionRegistry
          .connect(doctor)
          .issuePrescription(prescriptionId, patientHash, MEDICINE_ID, BATCH_ID, validExpiryTime)
      ).to.be.revertedWithCustomError(prescriptionRegistry, "PrescriptionAlreadyExists");
    });

    it("Should reject issuance with expired expiryTime", async function () {
      const pastTimestamp = (await time.latest()) - 100;
      await expect(
        prescriptionRegistry
          .connect(doctor)
          .issuePrescription(prescriptionId, patientHash, MEDICINE_ID, BATCH_ID, pastTimestamp)
      ).to.be.revertedWithCustomError(prescriptionRegistry, "InvalidExpiryTime");
    });

    it("Should reject issuance with zero prescriptionId or zero patientHash", async function () {
      await expect(
        prescriptionRegistry
          .connect(doctor)
          .issuePrescription(ethers.ZeroHash, patientHash, MEDICINE_ID, BATCH_ID, validExpiryTime)
      ).to.be.revertedWithCustomError(prescriptionRegistry, "InvalidPrescriptionId");

      await expect(
        prescriptionRegistry
          .connect(doctor)
          .issuePrescription(prescriptionId, ethers.ZeroHash, MEDICINE_ID, BATCH_ID, validExpiryTime)
      ).to.be.revertedWithCustomError(prescriptionRegistry, "InvalidPatientHash");
    });
  });

  describe("4. Single-Use Dispensing Enforcement", function () {
    beforeEach(async function () {
      await prescriptionRegistry
        .connect(doctor)
        .issuePrescription(prescriptionId, patientHash, MEDICINE_ID, BATCH_ID, validExpiryTime);
    });

    it("Should allow authorized pharmacy to dispense an active prescription", async function () {
      const tx = await prescriptionRegistry.connect(pharmacy).verifyAndDispense(prescriptionId);

      await expect(tx)
        .to.emit(prescriptionRegistry, "PrescriptionDispensed")
        .withArgs(
          prescriptionId,
          pharmacy.address,
          patientHash,
          await time.latest()
        );

      const rx = await prescriptionRegistry.getPrescription(prescriptionId);
      expect(rx.status).to.equal(1); // USED
    });

    it("Should strictly enforce single-use and reject double dispensing attempts", async function () {
      // First dispensing succeeds
      await prescriptionRegistry.connect(pharmacy).verifyAndDispense(prescriptionId);

      // Second dispensing attempt must be rejected
      await expect(
        prescriptionRegistry.connect(pharmacy).verifyAndDispense(prescriptionId)
      ).to.be.revertedWithCustomError(prescriptionRegistry, "PrescriptionNotActive");
    });

    it("Should verify patient identity hash upon dispensing when requested", async function () {
      const wrongHash = ethers.keccak256(ethers.toUtf8Bytes("unrelated_patient_identity"));

      // Reject when presented hash does not match
      await expect(
        prescriptionRegistry
          .connect(pharmacy)
          .verifyAndDispenseWithPatientHash(prescriptionId, wrongHash)
      ).to.be.revertedWithCustomError(prescriptionRegistry, "PatientHashMismatch");

      // Succeed when presented hash matches
      await expect(
        prescriptionRegistry
          .connect(pharmacy)
          .verifyAndDispenseWithPatientHash(prescriptionId, patientHash)
      ).to.emit(prescriptionRegistry, "PrescriptionDispensed");
    });

    it("Should reject dispensing without the patient's matching hash", async function () {
      await expect(
        prescriptionRegistry.connect(pharmacy).verifyAndDispenseWithPatientHash(prescriptionId, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(prescriptionRegistry, "PatientHashMismatch");
    });

    it("Should not allow repeated dispensing after a successful verified dispense", async function () {
      await prescriptionRegistry.connect(pharmacy).verifyAndDispenseWithPatientHash(prescriptionId, patientHash);
      await expect(
        prescriptionRegistry.connect(pharmacy).verifyAndDispenseWithPatientHash(prescriptionId, patientHash)
      ).to.be.revertedWithCustomError(prescriptionRegistry, "PrescriptionNotActive");
    });
  });

  describe("5. Unauthorized Access Rejections", function () {
    it("Should reject non-doctor accounts from issuing prescriptions", async function () {
      await expect(
        prescriptionRegistry
          .connect(unauthorizedUser)
          .issuePrescription(prescriptionId, patientHash, MEDICINE_ID, BATCH_ID, validExpiryTime)
      ).to.be.revertedWithCustomError(prescriptionRegistry, "AccessControlUnauthorizedAccount");
    });

    it("Should reject non-pharmacy accounts from dispensing prescriptions", async function () {
      await prescriptionRegistry
        .connect(doctor)
        .issuePrescription(prescriptionId, patientHash, MEDICINE_ID, BATCH_ID, validExpiryTime);

      await expect(
        prescriptionRegistry.connect(unauthorizedUser).verifyAndDispense(prescriptionId)
      ).to.be.revertedWithCustomError(prescriptionRegistry, "AccessControlUnauthorizedAccount");

      // Doctor is also not authorized to dispense
      await expect(
        prescriptionRegistry.connect(doctor).verifyAndDispense(prescriptionId)
      ).to.be.revertedWithCustomError(prescriptionRegistry, "AccessControlUnauthorizedAccount");
    });

    it("Should reject unauthorized callers from revoking prescriptions", async function () {
      await prescriptionRegistry
        .connect(doctor)
        .issuePrescription(prescriptionId, patientHash, MEDICINE_ID, BATCH_ID, validExpiryTime);

      await expect(
        prescriptionRegistry
          .connect(unauthorizedUser)
          .revokePrescription(prescriptionId, "Unauthorized attempt")
      ).to.be.revertedWithCustomError(prescriptionRegistry, "UnauthorizedRevoker");
    });

    it("Should reject non-admin accounts from configuring thresholds or registries", async function () {
      await expect(
        prescriptionRegistry.connect(doctor).setRiskThreshold(25)
      ).to.be.revertedWithCustomError(prescriptionRegistry, "AccessControlUnauthorizedAccount");

      await expect(
        prescriptionRegistry.connect(pharmacy).setTrustThreshold(80)
      ).to.be.revertedWithCustomError(prescriptionRegistry, "AccessControlUnauthorizedAccount");
    });
  });

  describe("6. Expired Prescription Checks", function () {
    let shortExpiryId;
    let shortExpiryTime;

    beforeEach(async function () {
      shortExpiryId = ethers.keccak256(ethers.toUtf8Bytes("PRESCRIPTION-EXPIRE-TEST"));
      const latestTime = await time.latest();
      shortExpiryTime = latestTime + 1800; // 30 minutes validity

      await prescriptionRegistry
        .connect(doctor)
        .issuePrescription(shortExpiryId, patientHash, MEDICINE_ID, BATCH_ID, shortExpiryTime);
    });

    it("Should dynamically report status as EXPIRED after time elapses", async function () {
      // Advance time past expiry
      await time.increase(2000);

      const rx = await prescriptionRegistry.getPrescription(shortExpiryId);
      expect(rx.status).to.equal(2); // EXPIRED
    });

    it("Should reject dispensing of an expired prescription", async function () {
      await time.increase(2000);

      await expect(
        prescriptionRegistry.connect(pharmacy).verifyAndDispense(shortExpiryId)
      ).to.be.revertedWithCustomError(prescriptionRegistry, "PrescriptionExpired");
    });
  });

  describe("7. Revocation Lifecycle", function () {
    beforeEach(async function () {
      await prescriptionRegistry
        .connect(doctor)
        .issuePrescription(prescriptionId, patientHash, MEDICINE_ID, BATCH_ID, validExpiryTime);
    });

    it("Should allow the issuing doctor to revoke an active prescription", async function () {
      await expect(
        prescriptionRegistry
          .connect(doctor)
          .revokePrescription(prescriptionId, "Incorrect medication dosage")
      ).to.emit(prescriptionRegistry, "PrescriptionRevoked");

      const rx = await prescriptionRegistry.getPrescription(prescriptionId);
      expect(rx.status).to.equal(3); // REVOKED
    });

    it("Should allow admin to revoke an active prescription", async function () {
      await expect(
        prescriptionRegistry
          .connect(owner)
          .revokePrescription(prescriptionId, "Emergency admin recall")
      ).to.emit(prescriptionRegistry, "PrescriptionRevoked");
    });

    it("Should prevent dispensing of a revoked prescription", async function () {
      await prescriptionRegistry
        .connect(doctor)
        .revokePrescription(prescriptionId, "Revoked by doctor");

      await expect(
        prescriptionRegistry.connect(pharmacy).verifyAndDispense(prescriptionId)
      ).to.be.revertedWithCustomError(prescriptionRegistry, "PrescriptionNotActive");
    });
  });

  describe("8. Cross-Component Interface Checks (Component 2 & Component 3)", function () {
    beforeEach(async function () {
      await prescriptionRegistry
        .connect(doctor)
        .issuePrescription(prescriptionId, patientHash, MEDICINE_ID, BATCH_ID, validExpiryTime);
    });

    async function useRiskMock({
      exists = true,
      score = 15,
      isSafe = true,
      revertHasBatchRisk = false,
      revertGetRiskScore = false,
      revertIsBatchSafe = false,
    }) {
      const factory = await ethers.getContractFactory("MockMedicineRiskRegistry");
      const riskMock = await factory.deploy(
        exists,
        score,
        isSafe,
        revertHasBatchRisk,
        revertGetRiskScore,
        revertIsBatchSafe
      );
      await riskMock.waitForDeployment();
      await prescriptionRegistry.setRiskRegistry(await riskMock.getAddress());
      return riskMock;
    }

    async function expectRiskFailure(errorPromise) {
      await errorPromise;
      const record = await prescriptionRegistry.getPrescription(prescriptionId);
      expect(record.status).to.equal(0); // ACTIVE: failed checks must not consume it
      const dispensed = await prescriptionRegistry.queryFilter(
        prescriptionRegistry.filters.PrescriptionDispensed(prescriptionId),
        0,
        "latest"
      );
      expect(dispensed).to.have.length(0);
    }

    for (const [score, isSafe] of [[0, true], [69, true]]) {
      it(`allows a recorded safe risk score of ${score}`, async function () {
        await mockRiskRegistry.setBatchRisk(BATCH_ID, score, isSafe);
        await expect(
          prescriptionRegistry.connect(pharmacy).verifyAndDispense(prescriptionId)
        ).to.emit(prescriptionRegistry, "PrescriptionDispensed");
      });
    }

    for (const score of [70, 71, 100]) {
      it(`rejects risk score ${score} and leaves the prescription active`, async function () {
        await mockRiskRegistry.setBatchRisk(BATCH_ID, score, false);
        await expectRiskFailure(
          expect(prescriptionRegistry.connect(pharmacy).verifyAndDispense(prescriptionId))
            .to.be.revertedWithCustomError(prescriptionRegistry, "HighMedicineRisk")
        );
      });
    }

    it("rejects a missing batch risk record", async function () {
      const riskMock = await useRiskMock({ exists: false });
      await expectRiskFailure(
        expect(prescriptionRegistry.connect(pharmacy).verifyAndDispense(prescriptionId))
          .to.be.revertedWithCustomError(prescriptionRegistry, "RiskRecordNotFound")
          .withArgs(BATCH_ID)
      );
      expect(await riskMock.hasBatchRisk(BATCH_ID)).to.equal(false);
    });

    it("rejects an out-of-range score returned by a registry", async function () {
      await useRiskMock({ score: 101, isSafe: false });
      await expectRiskFailure(
        expect(prescriptionRegistry.connect(pharmacy).verifyAndDispense(prescriptionId))
          .to.be.revertedWithCustomError(prescriptionRegistry, "RiskScoreOutOfRange")
          .withArgs(BATCH_ID, 101)
      );
    });

    it("rejects contradictory score and safety flag data returned by a registry", async function () {
      await useRiskMock({ score: 69, isSafe: false });
      await expectRiskFailure(
        expect(prescriptionRegistry.connect(pharmacy).verifyAndDispense(prescriptionId))
          .to.be.revertedWithCustomError(prescriptionRegistry, "RiskSafetyFlagMismatch")
          .withArgs(BATCH_ID, 69, false)
      );
    });

    it("fails closed when the configured registry call reverts", async function () {
      const riskMock = await useRiskMock({ revertHasBatchRisk: true });
      await expectRiskFailure(
        expect(prescriptionRegistry.connect(pharmacy).verifyAndDispense(prescriptionId))
          .to.be.revertedWithCustomError(riskMock, "MockHasBatchRiskFailed")
      );
    });

    it("fails closed when getRiskScore reverts after hasBatchRisk succeeds", async function () {
      const riskMock = await useRiskMock({ revertGetRiskScore: true });
      expect(await riskMock.hasBatchRisk(BATCH_ID)).to.equal(true);
      await expectRiskFailure(
        expect(prescriptionRegistry.connect(pharmacy).verifyAndDispense(prescriptionId))
          .to.be.revertedWithCustomError(riskMock, "MockRiskScoreReadFailed")
      );
    });

    it("fails closed when isBatchSafe reverts after record and score reads succeed", async function () {
      const riskMock = await useRiskMock({ revertIsBatchSafe: true });
      expect(await riskMock.hasBatchRisk(BATCH_ID)).to.equal(true);
      expect(await riskMock.getRiskScore(BATCH_ID)).to.equal(15);
      await expectRiskFailure(
        expect(prescriptionRegistry.connect(pharmacy).verifyAndDispense(prescriptionId))
          .to.be.revertedWithCustomError(riskMock, "MockRiskSafetyReadFailed")
      );
    });

    it("fails closed when the risk registry is unset or has no contract code", async function () {
      await prescriptionRegistry.setRiskRegistry(ethers.ZeroAddress);
      await expectRiskFailure(
        expect(prescriptionRegistry.connect(pharmacy).verifyAndDispense(prescriptionId))
          .to.be.revertedWithCustomError(prescriptionRegistry, "RiskRegistryNotConfigured")
      );

      await prescriptionRegistry.setRiskRegistry("0x000000000000000000000000000000000000dEaD");
      await expectRiskFailure(
        expect(prescriptionRegistry.connect(pharmacy).verifyAndDispense(prescriptionId))
          .to.be.revertedWithCustomError(prescriptionRegistry, "RiskRegistryUnavailable")
      );
    });

    it("does not allow the admin to raise the risk cutoff to 70 or above", async function () {
      await expect(prescriptionRegistry.setRiskThreshold(70))
        .to.be.revertedWithCustomError(prescriptionRegistry, "InvalidRiskThreshold")
        .withArgs(70);
      await expect(prescriptionRegistry.setRiskThreshold(100))
        .to.be.revertedWithCustomError(prescriptionRegistry, "InvalidRiskThreshold")
        .withArgs(100);
    });

    it("Should reject dispensing if Pharmacy Trust Score is below required threshold (Component 3)", async function () {
      // untrustedPharmacy has trust score 30 < 70
      await expect(
        prescriptionRegistry.connect(untrustedPharmacy).verifyAndDispense(prescriptionId)
      ).to.be.revertedWithCustomError(prescriptionRegistry, "LowPharmacyTrust");
    });

    it("Should allow dispensing when Risk is low and Pharmacy is trusted", async function () {
      // Both pass checks
      await expect(
        prescriptionRegistry.connect(pharmacy).verifyAndDispense(prescriptionId)
      ).to.emit(prescriptionRegistry, "PrescriptionDispensed");
    });
  });
});
