const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Component 4 V2: PrescriptionRegistryV2 lifecycle foundation", function () {
  let registry;
  let riskRegistry;
  let pharmacyTrustRegistry;
  let admin;
  let doctor;
  let pharmacy;
  let otherPharmacy;
  let unauthorized;
  let prescriptionId;
  let expiryTime;

  const MEDICINE_ID = "MED-SYNTHETIC-01";
  const BATCH_ID = "BATCH-SYNTHETIC-01";

  async function issue(id = prescriptionId, expiry = expiryTime, intendedPharmacy = pharmacy.address) {
    return registry.connect(doctor).issuePrescription(
      id,
      MEDICINE_ID,
      BATCH_ID,
      intendedPharmacy,
      expiry
    );
  }

  beforeEach(async function () {
    [admin, doctor, pharmacy, otherPharmacy, unauthorized] = await ethers.getSigners();

    const RiskRegistry = await ethers.getContractFactory("MedicineRiskRegistry");
    riskRegistry = await RiskRegistry.deploy(admin.address);
    await riskRegistry.waitForDeployment();
    await riskRegistry.setBatchRisk(BATCH_ID, 15, true);

    const PharmacyTrust = await ethers.getContractFactory("PharmacyTrust");
    pharmacyTrustRegistry = await PharmacyTrust.deploy(admin.address);
    await pharmacyTrustRegistry.waitForDeployment();
    await pharmacyTrustRegistry.setPharmacyTrust(pharmacy.address, 95, true);

    const Registry = await ethers.getContractFactory("PrescriptionRegistryV2");
    registry = await Registry.deploy(
      admin.address,
      await riskRegistry.getAddress(),
      await pharmacyTrustRegistry.getAddress()
    );
    await registry.waitForDeployment();

    await registry.grantRole(await registry.DOCTOR_ROLE(), doctor.address);
    await registry.grantRole(await registry.PHARMACY_ROLE(), pharmacy.address);
    await registry.grantRole(await registry.PHARMACY_ROLE(), otherPharmacy.address);

    // Synthetic random ID: independent of any patient data.
    prescriptionId = ethers.hexlify(ethers.randomBytes(32));
    expiryTime = BigInt(await time.latest()) + 3600n;
  });

  describe("issuance", function () {
    it("allows an authorized doctor to issue a patient-free, pharmacy-bound prescription", async function () {
      await expect(issue()).to.emit(registry, "PrescriptionIssued");

      const record = await registry.getPrescription(prescriptionId);
      expect(record.prescriptionId).to.equal(prescriptionId);
      expect(record.medicineId).to.equal(MEDICINE_ID);
      expect(record.batchId).to.equal(BATCH_ID);
      expect(record.doctorAddress).to.equal(doctor.address);
      expect(record.intendedPharmacy).to.equal(pharmacy.address);
      expect(record.expiryTime).to.equal(expiryTime);
      expect(record.status).to.equal(0n); // ACTIVE
    });

    it("rejects issuance by an unauthorized account", async function () {
      await expect(
        registry.connect(unauthorized).issuePrescription(
          prescriptionId,
          MEDICINE_ID,
          BATCH_ID,
          pharmacy.address,
          expiryTime
        )
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("rejects a zero or duplicate prescription ID", async function () {
      await expect(issue(ethers.ZeroHash))
        .to.be.revertedWithCustomError(registry, "InvalidPrescriptionId");

      await issue();
      await expect(issue())
        .to.be.revertedWithCustomError(registry, "PrescriptionAlreadyExists")
        .withArgs(prescriptionId);
    });

    it("rejects a zero intended pharmacy", async function () {
      await expect(issue(prescriptionId, expiryTime, ethers.ZeroAddress))
        .to.be.revertedWithCustomError(registry, "InvalidIntendedPharmacy");
    });

    it("rejects empty medicine or batch IDs", async function () {
      await expect(
        registry.connect(doctor).issuePrescription(
          prescriptionId,
          "",
          BATCH_ID,
          pharmacy.address,
          expiryTime
        )
      ).to.be.revertedWithCustomError(registry, "EmptyMedicineId");

      await expect(
        registry.connect(doctor).issuePrescription(
          prescriptionId,
          MEDICINE_ID,
          "",
          pharmacy.address,
          expiryTime
        )
      ).to.be.revertedWithCustomError(registry, "EmptyBatchId");
    });

    it("rejects invalid and already-expired issue times", async function () {
      const now = BigInt(await time.latest());
      await expect(issue(prescriptionId, now))
        .to.be.revertedWithCustomError(registry, "InvalidExpiryTime");
      await expect(issue(prescriptionId, now - 1n))
        .to.be.revertedWithCustomError(registry, "InvalidExpiryTime");
    });
  });

  describe("expiry and revocation", function () {
    beforeEach(async function () {
      await issue();
    });

    it("treats the exact expiry timestamp as expired", async function () {
      await time.increaseTo(Number(expiryTime));
      const record = await registry.getPrescription(prescriptionId);
      expect(record.status).to.equal(2n); // EXPIRED at timestamp >= expiryTime
      await expect(registry.connect(pharmacy).dispensePrescription(prescriptionId))
        .to.be.revertedWithCustomError(registry, "PrescriptionNotActive")
        .withArgs(prescriptionId, 2);
    });

    it("allows anyone to persist expiry and emits the status change at the exact expiry time", async function () {
      await time.increaseTo(Number(expiryTime));

      await expect(registry.connect(unauthorized).expirePrescription(prescriptionId))
        .to.emit(registry, "PrescriptionStatusChanged");

      expect((await registry.getPrescription(prescriptionId)).status).to.equal(2n); // EXPIRED
      await expect(registry.connect(pharmacy).dispensePrescription(prescriptionId))
        .to.be.revertedWithCustomError(registry, "PrescriptionNotActive")
        .withArgs(prescriptionId, 2);
    });

    it("rejects expiry finalization before the prescription expires", async function () {
      const currentTimestamp = BigInt(await time.latest()) + 1n;
      await expect(registry.connect(unauthorized).expirePrescription(prescriptionId))
        .to.be.revertedWithCustomError(registry, "PrescriptionNotExpired")
        .withArgs(prescriptionId, expiryTime, currentTimestamp);
      expect((await registry.getPrescription(prescriptionId)).status).to.equal(0n); // remains ACTIVE
    });

    it("allows the issuing doctor to revoke an active prescription", async function () {
      await expect(registry.connect(doctor).revokePrescription(prescriptionId))
        .to.emit(registry, "PrescriptionRevoked");
      expect((await registry.getPrescription(prescriptionId)).status).to.equal(3n); // REVOKED
    });

    it("allows an administrator to revoke an active prescription", async function () {
      await expect(registry.connect(admin).revokePrescription(prescriptionId))
        .to.emit(registry, "PrescriptionRevoked");
      expect((await registry.getPrescription(prescriptionId)).status).to.equal(3n); // REVOKED
    });

    it("rejects unauthorized revocation", async function () {
      await expect(registry.connect(unauthorized).revokePrescription(prescriptionId))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("rejects revocation of an unknown prescription", async function () {
      await expect(registry.connect(admin).revokePrescription(ethers.hexlify(ethers.randomBytes(32)))
      ).to.be.revertedWithCustomError(registry, "PrescriptionNotFound");
    });
  });

  describe("dispensing fail-closed boundary", function () {
    beforeEach(async function () {
      await issue();
    });

    it("lets a registered trusted pharmacy reach the patient-authorization block", async function () {
      await expect(registry.connect(pharmacy).dispensePrescription(prescriptionId))
        .to.be.revertedWithCustomError(registry, "PatientAuthorizationUnavailable");
      expect((await registry.getPrescription(prescriptionId)).status).to.equal(0n); // remains ACTIVE
    });

    it("blocks dispensing when the pharmacy-trust registry is unconfigured", async function () {
      await registry.setPharmacyTrustRegistry(ethers.ZeroAddress);

      await expect(registry.connect(pharmacy).dispensePrescription(prescriptionId))
        .to.be.revertedWithCustomError(registry, "PharmacyTrustRegistryUnavailable");
      expect((await registry.getPrescription(prescriptionId)).status).to.equal(0n); // remains ACTIVE
    });

    it("blocks dispensing when the pharmacy-trust registry address has no contract code", async function () {
      await registry.setPharmacyTrustRegistry(unauthorized.address);

      await expect(registry.connect(pharmacy).dispensePrescription(prescriptionId))
        .to.be.revertedWithCustomError(registry, "PharmacyTrustRegistryUnavailable");
      expect((await registry.getPrescription(prescriptionId)).status).to.equal(0n); // remains ACTIVE
    });

    it("blocks an unknown pharmacy based on the Component 3 trust record", async function () {
      const otherPrescriptionId = ethers.hexlify(ethers.randomBytes(32));
      await issue(otherPrescriptionId, expiryTime, otherPharmacy.address);

      await expect(registry.connect(otherPharmacy).dispensePrescription(
        otherPrescriptionId
      )).to.be.revertedWithCustomError(registry, "PharmacyNotRegistered")
        .withArgs(otherPharmacy.address);
      expect((await registry.getPrescription(otherPrescriptionId)).status).to.equal(0n); // remains ACTIVE
    });

    it("blocks a registered but explicitly untrusted pharmacy", async function () {
      await pharmacyTrustRegistry.setPharmacyTrust(pharmacy.address, 95, false);

      await expect(registry.connect(pharmacy).dispensePrescription(prescriptionId))
        .to.be.revertedWithCustomError(registry, "PharmacyNotTrusted");
      expect((await registry.getPrescription(prescriptionId)).status).to.equal(0n); // remains ACTIVE
    });

    it("blocks dispensing when the registration response is malformed", async function () {
      const MalformedRegistry = await ethers.getContractFactory("MockPharmacyTrustRegistry");
      const malformedRegistry = await MalformedRegistry.deploy(true, 95, true, 2);
      await malformedRegistry.waitForDeployment();
      await registry.setPharmacyTrustRegistry(await malformedRegistry.getAddress());

      await expect(registry.connect(pharmacy).dispensePrescription(prescriptionId)).to.be.reverted;
      expect((await registry.getPrescription(prescriptionId)).status).to.equal(0n); // remains ACTIVE
    });

    it("blocks dispensing when registration, score, or trusted-status queries fail or return malformed data", async function () {
      const MockRegistry = await ethers.getContractFactory("MockPharmacyTrustRegistry");
      // Modes 1-6: registration revert/malformed, score revert/malformed, trusted-status revert/malformed.
      for (const failureMode of [1, 2, 3, 4, 5, 6]) {
        const failingRegistry = await MockRegistry.deploy(true, 95, true, failureMode);
        await failingRegistry.waitForDeployment();
        await registry.setPharmacyTrustRegistry(await failingRegistry.getAddress());

        await expect(registry.connect(pharmacy).dispensePrescription(prescriptionId)).to.be.reverted;
        expect((await registry.getPrescription(prescriptionId)).status).to.equal(0n); // remains ACTIVE
      }
    });

    it("blocks a pharmacy below the configured trust-score threshold", async function () {
      await pharmacyTrustRegistry.setPharmacyTrust(pharmacy.address, 69, true);

      await expect(registry.connect(pharmacy).dispensePrescription(prescriptionId))
        .to.be.revertedWithCustomError(registry, "LowPharmacyTrust")
        .withArgs(pharmacy.address, 69n, 70n);
      expect((await registry.getPrescription(prescriptionId)).status).to.equal(0n); // remains ACTIVE
    });

    it("blocks dispensing when the configured trust registry cannot answer the trust check", async function () {
      await registry.setPharmacyTrustRegistry(await riskRegistry.getAddress());

      await expect(registry.connect(pharmacy).dispensePrescription(prescriptionId))
        .to.be.reverted;
      expect((await registry.getPrescription(prescriptionId)).status).to.equal(0n); // remains ACTIVE
    });

    it("rejects a pharmacy other than the prescription's intended pharmacy", async function () {
      await expect(registry.connect(otherPharmacy).dispensePrescription(prescriptionId))
        .to.be.revertedWithCustomError(registry, "WrongIntendedPharmacy")
        .withArgs(pharmacy.address, otherPharmacy.address);
      expect((await registry.getPrescription(prescriptionId)).status).to.equal(0n); // remains ACTIVE
    });

    it("does not emit a dispense event or consume the prescription", async function () {
      await expect(registry.connect(pharmacy).dispensePrescription(prescriptionId))
        .to.be.revertedWithCustomError(registry, "PatientAuthorizationUnavailable");
      const logs = await registry.queryFilter(
        registry.filters.PrescriptionStatusChanged(prescriptionId),
        0,
        "latest"
      );
      expect(logs).to.have.length(0);
      expect((await registry.getPrescription(prescriptionId)).status).to.equal(0n);
    });
  });

  describe("public ABI privacy boundary", function () {
    it("exposes no patient-derived parameter, return field, or event field", async function () {
      const forbidden = /(patienthash|patientid|patientidentifier|credentialid|credentialhandle|nullifier|commitment|subjectsecret)/i;
      const assertClean = (parameter) => {
        expect(parameter.name).not.to.match(forbidden);
        for (const component of parameter.components || []) assertClean(component);
      };

      for (const fragment of registry.interface.fragments) {
        if (fragment.inputs) fragment.inputs.forEach(assertClean);
        if (fragment.outputs) fragment.outputs.forEach(assertClean);
      }

      const record = registry.interface.getFunction("getPrescription").outputs[0];
      expect(record.components.map((field) => field.name)).to.deep.equal([
        "prescriptionId",
        "medicineId",
        "batchId",
        "doctorAddress",
        "intendedPharmacy",
        "issuedAt",
        "expiryTime",
        "status",
      ]);
      expect(registry.interface.getEvent("PrescriptionIssued").inputs.map((field) => field.name))
        .not.to.include("patientHash");
      expect(registry.interface.getEvent("PrescriptionRevoked").inputs.map((field) => field.name))
        .not.to.include("patientHash");
    });
  });
});
