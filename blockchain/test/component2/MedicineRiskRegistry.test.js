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

  it("records and updates a batch risk assessment", async function () {
    await expect(registry.setBatchRisk("BATCH-001", 24, true))
      .to.emit(registry, "BatchRiskUpdated")
      .withArgs("BATCH-001", 24, true, anyValue);

    expect(await registry.getRiskScore("BATCH-001")).to.equal(24);
    expect(await registry.isBatchSafe("BATCH-001")).to.equal(true);

    await registry.setBatchRisk("BATCH-001", 82, false);
    expect(await registry.getRiskScore("BATCH-001")).to.equal(82);
    expect(await registry.isBatchSafe("BATCH-001")).to.equal(false);
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

  it("treats an unknown batch as safe with a zero score", async function () {
    expect(await registry.getRiskScore("UNKNOWN")).to.equal(0);
    expect(await registry.isBatchSafe("UNKNOWN")).to.equal(true);
  });
});
