const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("Component 2: MedicineRiskRegistry", function () {
  let registry;
  let admin;
  let oracle;
  let outsider;

  beforeEach(async function () {
    [admin, oracle, outsider] = await ethers.getSigners();
    registry = await ethers.deployContract("MedicineRiskRegistry", [admin.address]);
    await registry.waitForDeployment();
  });

  it("assigns administrator and oracle privileges to the configured admin", async function () {
    expect(
      await registry.hasRole(await registry.DEFAULT_ADMIN_ROLE(), admin.address)
    ).to.equal(true);
    expect(await registry.hasRole(await registry.ORACLE_ROLE(), admin.address)).to.equal(
      true
    );
  });

  it("records boundary scores and distinguishes a recorded zero from a missing batch", async function () {
    expect(await registry.hasBatchRisk("BATCH-001")).to.equal(false);
    expect(await registry.getRiskScore("BATCH-001")).to.equal(0);

    for (const [score, isSafe] of [[0, true], [69, true], [70, false], [71, false], [100, false]]) {
      await expect(registry.setBatchRisk("BATCH-001", score, isSafe))
        .to.emit(registry, "BatchRiskUpdated")
        .withArgs("BATCH-001", score, isSafe, anyValue);
      expect(await registry.hasBatchRisk("BATCH-001")).to.equal(true);
      expect(await registry.getRiskScore("BATCH-001")).to.equal(score);
      expect(await registry.isBatchSafe("BATCH-001")).to.equal(isSafe);
    }
  });

  it("allows a granted oracle to publish assessments", async function () {
    await registry.grantRole(await registry.ORACLE_ROLE(), oracle.address);

    await registry.connect(oracle).setBatchRisk("BATCH-002", 41, true);

    expect(await registry.getRiskScore("BATCH-002")).to.equal(41);
  });

  it("rejects risk updates from accounts without the oracle role", async function () {
    await expect(
      registry.connect(outsider).setBatchRisk("BATCH-003", 33, true)
    )
      .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
      .withArgs(outsider.address, await registry.ORACLE_ROLE());
  });

  it("preserves default getter values while reporting that an unknown batch is not recorded", async function () {
    expect(await registry.getRiskScore("UNKNOWN")).to.equal(0);
    expect(await registry.isBatchSafe("UNKNOWN")).to.equal(true);
    expect(await registry.hasBatchRisk("UNKNOWN")).to.equal(false);
  });

  it("rejects scores outside the 0-100 range", async function () {
    await expect(registry.setBatchRisk("BATCH-INVALID", 101, false))
      .to.be.revertedWithCustomError(registry, "RiskScoreOutOfRange")
      .withArgs(101);
  });

  it("rejects safety flags inconsistent with the integer 70-point boundary", async function () {
    await expect(registry.setBatchRisk("BATCH-INVALID", 69, false))
      .to.be.revertedWithCustomError(registry, "RiskSafetyFlagMismatch")
      .withArgs(69, false);
    await expect(registry.setBatchRisk("BATCH-INVALID", 70, true))
      .to.be.revertedWithCustomError(registry, "RiskSafetyFlagMismatch")
      .withArgs(70, true);
  });
});
