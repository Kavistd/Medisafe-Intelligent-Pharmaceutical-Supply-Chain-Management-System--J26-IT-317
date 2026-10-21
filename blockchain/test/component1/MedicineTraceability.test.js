const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Component 1: MedicineTraceability", function () {
  before(function () {
    expect(network.name, "Use the isolated --network hardhat network").to.equal("hardhat");
  });

  async function custodySnapshot(contract, batchId) {
    try {
      return {
        batch: (await contract.getBatch(batchId)).toArray(true),
        pending: (await contract.getPendingTransfer(batchId)).toArray(true),
        history: (await contract.getTransferHistory(batchId)).toArray(true),
      };
    } catch (error) {
      expect(contract.interface.parseError(error.data).name).to.equal("BatchNotFound");
      for (const method of ["getBatch", "getPendingTransfer", "getTransferHistory"])
        await expect(contract[method](batchId)).to.be.revertedWithCustomError(contract, "BatchNotFound").withArgs(batchId);
      return { absent: true };
    }
  }

  // Check both preflight rejection and a mined failed transaction, not estimation alone.
  async function rejectsWithoutStateChange(contract, batchId, signer, method, args, errorName, errorArgs = []) {
    const before = await custodySnapshot(contract, batchId);
    const check = promise => {
      const assertion = expect(promise).to.be.revertedWithCustomError(contract, errorName);
      return errorArgs.length ? assertion.withArgs(...errorArgs) : assertion;
    };
    await check(contract.connect(signer)[method].staticCall(...args));
    expect(await custodySnapshot(contract, batchId)).to.deep.equal(before);
    const submission = contract.connect(signer)[method](...args, { gasLimit: 1500000 });
    await check(submission);
    const failure = await submission.catch(error => error);
    const hash = failure.transactionHash || failure.data?.transactionHash;
    expect(hash, "Rejection must have a mined transaction receipt").to.be.a("string");
    const receipt = await ethers.provider.getTransactionReceipt(hash);
    expect(receipt.status).to.equal(0);
    expect(receipt.logs).to.have.length(0);
    expect(await custodySnapshot(contract, batchId)).to.deep.equal(before);
  }

  async function fixture() {
    const [admin, manufacturer, distributor, pharmacy, stranger, recall, otherManufacturer, otherDistributor] = await ethers.getSigners();
    const contract = await ethers.deployContract("MedicineTraceability", [admin.address]);
    await contract.waitForDeployment();
    for (const [role, account] of [
      ["MANUFACTURER_ROLE", manufacturer], ["MANUFACTURER_ROLE", otherManufacturer],
      ["DISTRIBUTOR_ROLE", distributor], ["DISTRIBUTOR_ROLE", otherDistributor],
      ["PHARMACY_ROLE", pharmacy], ["RECALL_ROLE", recall],
    ]) await contract.grantRole(await contract[role](), account.address);
    const now = await time.latest();
    const data = {
      batchId: "BATCH-2026-001", medicineId: "MED-AMOX-500", name: "Amoxicillin",
      category: "Antibiotic", dosageForm: "Capsule", strength: "500 mg",
      manufacturerName: "Example Manufacturer", indication: "Bacterial infection",
      classification: "Prescription", quantity: 1000, manufacturedAt: now - 86400,
      expiresAt: now + 86400, documentReference: "ipfs://bafy-document-reference",
      certificateReference: "ipfs://bafy-certificate-reference",
    };
    return { contract, admin, manufacturer, distributor, pharmacy, stranger, recall, otherManufacturer, otherDistributor, data };
  }

  async function registeredFixture() {
    const ctx = await fixture();
    await ctx.contract.connect(ctx.manufacturer).registerBatch(ctx.data);
    return ctx;
  }

  async function pendingFixture() {
    const ctx = await registeredFixture();
    await ctx.contract.connect(ctx.manufacturer).initiateTransfer(ctx.data.batchId, ctx.distributor.address);
    return ctx;
  }

  async function atDistributorFixture() {
    const ctx = await pendingFixture();
    await ctx.contract.connect(ctx.distributor).confirmTransfer(ctx.data.batchId, 1);
    return ctx;
  }

  describe("Access control", function () {
    it("grants only the administrator role to the explicit admin", async function () {
      const { contract, admin } = await loadFixture(fixture);
      expect(await contract.hasRole(await contract.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
      for (const role of ["MANUFACTURER_ROLE", "DISTRIBUTOR_ROLE", "PHARMACY_ROLE", "RECALL_ROLE"])
        expect(await contract.hasRole(await contract[role](), admin.address)).to.equal(false);
    });

    it("supports an admin different from the deployer and rejects zero admin", async function () {
      const { admin, stranger } = await loadFixture(fixture);
      const factory = await ethers.getContractFactory("MedicineTraceability");
      const deployed = await factory.deploy(stranger.address);
      expect(await deployed.hasRole(await deployed.DEFAULT_ADMIN_ROLE(), stranger.address)).to.equal(true);
      expect(await deployed.hasRole(await deployed.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(false);
      await expect(factory.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(factory, "InvalidAdmin");
    });

    it("rejects unauthorized grants and revocations; admin can grant and revoke", async function () {
      const { contract, stranger } = await loadFixture(fixture);
      const role = await contract.MANUFACTURER_ROLE();
      for (const method of ["grantRole", "revokeRole"])
        await expect(contract.connect(stranger)[method](role, stranger.address))
          .to.be.revertedWithCustomError(contract, "AccessControlUnauthorizedAccount");
      await contract.grantRole(role, stranger.address);
      expect(await contract.hasRole(role, stranger.address)).to.equal(true);
      await contract.revokeRole(role, stranger.address);
      expect(await contract.hasRole(role, stranger.address)).to.equal(false);
    });

    it("rejects registration by every non-manufacturer including admin", async function () {
      const { contract, admin, distributor, pharmacy, stranger, recall, data } = await loadFixture(fixture);
      for (const account of [admin, distributor, pharmacy, stranger, recall])
        await rejectsWithoutStateChange(contract, data.batchId, account, "registerBatch", [data],
          "AccessControlUnauthorizedAccount", [account.address, await contract.MANUFACTURER_ROLE()]);
    });
  });

  describe("Registration and mandatory validation", function () {
    it("stores all supplied data, manufacturer and initial custody; emits registration", async function () {
      const { contract, manufacturer, data } = await loadFixture(fixture);
      await expect(contract.connect(manufacturer).registerBatch(data)).to.emit(contract, "BatchRegistered")
        .withArgs(ethers.id(data.batchId), data.batchId, manufacturer.address);
      const batch = await contract.getBatch(data.batchId);
      for (const [key, value] of Object.entries(data)) expect(batch.data[key]).to.equal(value);
      expect(batch.manufacturer).to.equal(manufacturer.address);
      expect(batch.owner).to.equal(manufacturer.address);
      expect(batch.stage).to.equal(0);
      expect(batch.recalled).to.equal(false);
      expect(await contract.isBatchExpired(data.batchId)).to.equal(false);
      expect(await contract.getTransferHistory(data.batchId)).to.have.length(0);
      expect((await contract.getPendingTransfer(data.batchId)).id).to.equal(0);
    });

    it("rejects duplicate IDs even from another authorized manufacturer", async function () {
      const { contract, manufacturer, otherManufacturer, data } = await loadFixture(registeredFixture);
      for (const account of [manufacturer, otherManufacturer])
        await rejectsWithoutStateChange(contract, data.batchId, account, "registerBatch", [data], "BatchAlreadyExists", [data.batchId]);
    });

    for (const field of ["batchId", "medicineId", "name", "category", "dosageForm", "strength", "manufacturerName", "indication", "classification", "documentReference", "certificateReference"]) {
      for (const value of ["", " \t\r\n "]) {
        it(`rejects ${value === "" ? "empty" : "whitespace-only"} ${field}`, async function () {
          const { contract, manufacturer, data } = await loadFixture(fixture);
          const batch = { ...data, [field]: value };
          if (["documentReference", "certificateReference"].includes(field)) {
            await rejectsWithoutStateChange(contract, data.batchId, manufacturer, "registerBatch", [batch], "InvalidField", [field]);
          } else {
            await expect(contract.connect(manufacturer).registerBatch(batch))
              .to.be.revertedWithCustomError(contract, "InvalidField").withArgs(field);
          }
        });
      }
    }

    for (const [label, field, value] of [
      ["zero quantity", "quantity", () => 0],
      ["zero manufacture timestamp", "manufacturedAt", () => 0],
      ["future manufacture", "manufacturedAt", d => d.expiresAt + 100],
      ["zero expiry", "expiresAt", () => 0],
      ["past expiry", "expiresAt", d => d.manufacturedAt + 1],
      ["expiry before manufacture", "expiresAt", d => d.manufacturedAt - 1],
      ["expiry equal to manufacture", "expiresAt", d => d.manufacturedAt],
    ]) it(`rejects ${label}`, async function () {
      const { contract, manufacturer, data } = await loadFixture(fixture);
      await expect(contract.connect(manufacturer).registerBatch({ ...data, [field]: value(data) }))
        .to.be.revertedWithCustomError(contract, "InvalidField").withArgs(field);
    });

    it("rejects registration exactly at expiry", async function () {
      const { contract, manufacturer, data } = await loadFixture(fixture);
      await time.setNextBlockTimestamp(data.expiresAt);
      await expect(contract.connect(manufacturer).registerBatch(data)).to.be.revertedWithCustomError(contract, "InvalidField").withArgs("expiresAt");
    });

    it("keeps separate string batch IDs independent", async function () {
      const { contract, manufacturer, data } = await loadFixture(registeredFixture);
      await contract.connect(manufacturer).registerBatch({ ...data, batchId: "BATCH-002" });
      expect((await contract.getBatch("BATCH-002")).data.batchId).to.equal("BATCH-002");
      expect((await contract.getBatch(data.batchId)).data.batchId).to.equal(data.batchId);
    });
  });

  describe("Ordered, recipient-confirmed custody", function () {
    it("completes both stages with events and ordered history; pending requests do not change custody", async function () {
      const { contract, manufacturer, distributor, pharmacy, data } = await loadFixture(registeredFixture);
      for (const [from, to, id, stage] of [[manufacturer, distributor, 1, 1], [distributor, pharmacy, 2, 2]]) {
        await expect(contract.connect(from).initiateTransfer(data.batchId, to.address))
          .to.emit(contract, "TransferInitiated").withArgs(ethers.id(data.batchId), data.batchId, id, from.address, to.address, stage);
        const pending = await contract.getPendingTransfer(data.batchId);
        expect(pending.id).to.equal(id);
        expect(pending.from).to.equal(from.address);
        expect(pending.to).to.equal(to.address);
        expect(pending.nextStage).to.equal(stage);
        expect((await contract.getBatch(data.batchId)).owner).to.equal(from.address);
        expect((await contract.getBatch(data.batchId)).stage).to.equal(stage - 1);
        expect(await contract.getTransferHistoryCount(data.batchId)).to.equal(id - 1);
        await expect(contract.connect(to).confirmTransfer(data.batchId, id))
          .to.emit(contract, "TransferConfirmed").withArgs(ethers.id(data.batchId), data.batchId, id, from.address, to.address, stage);
        const batch = await contract.getBatch(data.batchId);
        expect(batch.owner).to.equal(to.address);
        expect(batch.stage).to.equal(stage);
        expect(batch.manufacturer).to.equal(manufacturer.address);
        expect((await contract.getPendingTransfer(data.batchId)).id).to.equal(0);
        const entry = await contract.getTransferHistoryEntry(data.batchId, id - 1);
        expect(entry.id).to.equal(id);
        expect(entry.from).to.equal(from.address);
        expect(entry.to).to.equal(to.address);
        expect(entry.stage).to.equal(stage);
        expect(entry.initiatedAt).to.equal(pending.initiatedAt);
        expect(entry.confirmedAt).to.equal(await time.latest());
        expect(entry.confirmedAt).to.be.greaterThanOrEqual(entry.initiatedAt);
      }
      expect(await contract.getTransferHistory(data.batchId)).to.have.length(2);
      await expect(contract.connect(pharmacy).initiateTransfer(data.batchId, distributor.address)).to.be.revertedWithCustomError(contract, "FinalStage");
      await expect(contract.getTransferHistoryEntry(data.batchId, 2)).to.be.revertedWithCustomError(contract, "HistoryIndexOutOfBounds");
    });

    it("rejects non-owners, including admin and another manufacturer", async function () {
      const { contract, admin, stranger, otherManufacturer, distributor, pharmacy, data } = await loadFixture(registeredFixture);
      for (const account of [admin, stranger, otherManufacturer, distributor])
        await rejectsWithoutStateChange(contract, data.batchId, account, "initiateTransfer",
          [data.batchId, account === distributor ? pharmacy.address : distributor.address], "NotCurrentOwner");
    });

    it("rejects zero/self recipients, unassigned recipients and skipped stages", async function () {
      const { contract, manufacturer, pharmacy, stranger, data } = await loadFixture(registeredFixture);
      for (const address of [ethers.ZeroAddress, manufacturer.address])
        await expect(contract.connect(manufacturer).initiateTransfer(data.batchId, address)).to.be.revertedWithCustomError(contract, "InvalidRecipient");
      for (const account of [pharmacy, stranger])
        await rejectsWithoutStateChange(contract, data.batchId, manufacturer, "initiateTransfer", [data.batchId, account.address], "InvalidParticipantRole");
    });

    it("rejects duplicate pending transfers and confirmations by sender/admin/another distributor", async function () {
      const { contract, manufacturer, distributor, otherDistributor, admin, data } = await loadFixture(pendingFixture);
      await expect(contract.connect(manufacturer).initiateTransfer(data.batchId, distributor.address)).to.be.revertedWithCustomError(contract, "TransferAlreadyPending");
      for (const account of [manufacturer, admin, otherDistributor])
        await rejectsWithoutStateChange(contract, data.batchId, account, "confirmTransfer", [data.batchId, 1], "NotRecipient");
      expect((await contract.getBatch(data.batchId)).owner).to.equal(manufacturer.address);
      expect(await contract.getTransferHistoryCount(data.batchId)).to.equal(0);
    });

    it("rejects confirmations without a pending request and repeated confirmation", async function () {
      const { contract, distributor, data } = await loadFixture(atDistributorFixture);
      await expect(contract.connect(distributor).confirmTransfer(data.batchId, 1)).to.be.revertedWithCustomError(contract, "NoPendingTransfer");
    });

    it("rejects reverse and same-stage transfers and the previous owner", async function () {
      const { contract, manufacturer, distributor, otherDistributor, pharmacy, data } = await loadFixture(atDistributorFixture);
      for (const recipient of [manufacturer, otherDistributor])
        await expect(contract.connect(distributor).initiateTransfer(data.batchId, recipient.address)).to.be.revertedWithCustomError(contract, "InvalidParticipantRole");
      await expect(contract.connect(manufacturer).initiateTransfer(data.batchId, pharmacy.address)).to.be.revertedWithCustomError(contract, "NotCurrentOwner");
    });

    it("uses custody stage even when a participant holds multiple roles", async function () {
      const { contract, manufacturer, distributor, pharmacy, data } = await loadFixture(registeredFixture);
      await contract.grantRole(await contract.DISTRIBUTOR_ROLE(), manufacturer.address);
      await expect(contract.connect(manufacturer).initiateTransfer(data.batchId, pharmacy.address)).to.be.revertedWithCustomError(contract, "InvalidParticipantRole");
      await contract.grantRole(await contract.PHARMACY_ROLE(), distributor.address);
      await contract.connect(manufacturer).initiateTransfer(data.batchId, distributor.address);
      await contract.connect(distributor).confirmTransfer(data.batchId, 1);
      expect((await contract.getBatch(data.batchId)).stage).to.equal(1);
      await expect(contract.connect(distributor).initiateTransfer(data.batchId, distributor.address)).to.be.revertedWithCustomError(contract, "InvalidRecipient");
    });

    it("rejects initiation after the owner's stage role is revoked", async function () {
      const { contract, manufacturer, distributor, data } = await loadFixture(registeredFixture);
      await contract.revokeRole(await contract.MANUFACTURER_ROLE(), manufacturer.address);
      await expect(contract.connect(manufacturer).initiateTransfer(data.batchId, distributor.address)).to.be.revertedWithCustomError(contract, "InvalidParticipantRole");
    });

    for (const party of ["manufacturer", "distributor"]) it(`rejects confirmation after ${party} role revocation`, async function () {
      const ctx = await loadFixture(pendingFixture);
      const role = party === "manufacturer" ? "MANUFACTURER_ROLE" : "DISTRIBUTOR_ROLE";
      await ctx.contract.revokeRole(await ctx.contract[role](), ctx[party].address);
      await expect(ctx.contract.connect(ctx.distributor).confirmTransfer(ctx.data.batchId, 1)).to.be.revertedWithCustomError(ctx.contract, "InvalidParticipantRole");
      expect((await ctx.contract.getBatch(ctx.data.batchId)).owner).to.equal(ctx.manufacturer.address);
      expect(await ctx.contract.getTransferHistoryCount(ctx.data.batchId)).to.equal(0);
    });
  });

  describe("Pending cancellation and stale requests", function () {
    for (const party of ["manufacturer", "distributor"]) it(`allows ${party} to cancel without recording completed custody`, async function () {
      const ctx = await loadFixture(pendingFixture);
      await expect(ctx.contract.connect(ctx[party]).cancelTransfer(ctx.data.batchId, 1))
        .to.emit(ctx.contract, "TransferCancelled").withArgs(ethers.id(ctx.data.batchId), ctx.data.batchId, 1, ctx[party].address);
      expect((await ctx.contract.getPendingTransfer(ctx.data.batchId)).id).to.equal(0);
      expect((await ctx.contract.getBatch(ctx.data.batchId)).owner).to.equal(ctx.manufacturer.address);
      expect(await ctx.contract.getTransferHistoryCount(ctx.data.batchId)).to.equal(0);
      await expect(ctx.contract.connect(ctx.distributor).confirmTransfer(ctx.data.batchId, 1)).to.be.revertedWithCustomError(ctx.contract, "NoPendingTransfer");
    });

    it("rejects third-party cancellation and stale IDs on a replacement request", async function () {
      const { contract, manufacturer, distributor, stranger, data } = await loadFixture(pendingFixture);
      await expect(contract.connect(stranger).cancelTransfer(data.batchId, 1)).to.be.revertedWithCustomError(contract, "NotTransferParticipant");
      await contract.connect(manufacturer).cancelTransfer(data.batchId, 1);
      await expect(contract.connect(manufacturer).cancelTransfer(data.batchId, 1)).to.be.revertedWithCustomError(contract, "NoPendingTransfer");
      await contract.connect(manufacturer).initiateTransfer(data.batchId, distributor.address);
      for (const method of ["confirmTransfer", "cancelTransfer"])
        await expect(contract.connect(distributor)[method](data.batchId, 1)).to.be.revertedWithCustomError(contract, "StaleTransfer");
      await contract.connect(distributor).confirmTransfer(data.batchId, 2);
      expect((await contract.getTransferHistoryEntry(data.batchId, 0)).id).to.equal(2);
      expect(await contract.getTransferHistoryCount(data.batchId)).to.equal(1);
    });
  });

  describe("Recall and expiry enforcement", function () {
    it("requires recall authorization and a reason; prevents repeated recall", async function () {
      const { contract, admin, manufacturer, recall, data } = await loadFixture(registeredFixture);
      for (const account of [admin, manufacturer])
        await expect(contract.connect(account).recallBatch(data.batchId, "Quality failure")).to.be.revertedWithCustomError(contract, "AccessControlUnauthorizedAccount");
      for (const reason of ["", " \n "])
        await expect(contract.connect(recall).recallBatch(data.batchId, reason)).to.be.revertedWithCustomError(contract, "InvalidField").withArgs("reason");
      await expect(contract.connect(recall).recallBatch(data.batchId, "Quality failure"))
        .to.emit(contract, "BatchRecallRecorded").withArgs(ethers.id(data.batchId), data.batchId, recall.address, "Quality failure");
      expect((await contract.getBatch(data.batchId)).recalled).to.equal(true);
      await expect(contract.connect(recall).recallBatch(data.batchId, "Again")).to.be.revertedWithCustomError(contract, "BatchRecalled");
    });

    for (const invalidity of ["recall", "expiry"]) {
      for (const stage of ["manufacturer", "distributor"]) {
        it(`blocks ${stage} initiation after ${invalidity}`, async function () {
          const ctx = await loadFixture(stage === "manufacturer" ? registeredFixture : atDistributorFixture);
          if (invalidity === "recall") await ctx.contract.connect(ctx.recall).recallBatch(ctx.data.batchId, "Recall");
          else await time.increaseTo(ctx.data.expiresAt);
          await rejectsWithoutStateChange(ctx.contract, ctx.data.batchId, ctx[stage], "initiateTransfer",
            [ctx.data.batchId, ctx[stage === "manufacturer" ? "distributor" : "pharmacy"].address],
            invalidity === "recall" ? "BatchRecalled" : "BatchExpired");
        });

        it(`blocks ${stage} pending confirmation after ${invalidity} without changing history`, async function () {
          const ctx = await loadFixture(stage === "manufacturer" ? pendingFixture : atDistributorFixture);
          const recipient = stage === "manufacturer" ? ctx.distributor : ctx.pharmacy;
          const id = stage === "manufacturer" ? 1 : 2;
          if (stage === "distributor") await ctx.contract.connect(ctx.distributor).initiateTransfer(ctx.data.batchId, recipient.address);
          if (invalidity === "recall") await ctx.contract.connect(ctx.recall).recallBatch(ctx.data.batchId, "Recall");
          else await time.setNextBlockTimestamp(ctx.data.expiresAt);
          await expect(ctx.contract.connect(recipient).confirmTransfer(ctx.data.batchId, id))
            .to.be.revertedWithCustomError(ctx.contract, invalidity === "recall" ? "BatchRecalled" : "BatchExpired");
          expect((await ctx.contract.getBatch(ctx.data.batchId)).owner).to.equal(ctx[stage].address);
          expect(await ctx.contract.getTransferHistoryCount(ctx.data.batchId)).to.equal(id - 1);
          expect((await ctx.contract.getPendingTransfer(ctx.data.batchId)).id).to.equal(id);
          await ctx.contract.connect(recipient).cancelTransfer(ctx.data.batchId, id);
          expect((await ctx.contract.getPendingTransfer(ctx.data.batchId)).id).to.equal(0);
        });
      }
    }

    it("allows confirmation just before expiry and reports expired exactly at expiry", async function () {
      const { contract, distributor, data } = await loadFixture(pendingFixture);
      await time.setNextBlockTimestamp(data.expiresAt - 1);
      await contract.connect(distributor).confirmTransfer(data.batchId, 1);
      expect(await contract.isBatchExpired(data.batchId)).to.equal(false);
      await time.increaseTo(data.expiresAt);
      expect(await contract.isBatchExpired(data.batchId)).to.equal(true);
      expect(await contract.getTransferHistoryCount(data.batchId)).to.equal(1);
    });

    it("permits recall of expired batches and preserves their readable data", async function () {
      const { contract, recall, data } = await loadFixture(registeredFixture);
      await time.increaseTo(data.expiresAt);
      await contract.connect(recall).recallBatch(data.batchId, "Expired stock recall");
      const batch = await contract.getBatch(data.batchId);
      expect(batch.recalled).to.equal(true);
      expect(batch.data.documentReference).to.equal(data.documentReference);
    });
  });

  it("rejects unknown batches consistently in mutations and queries", async function () {
    const { contract, manufacturer, distributor, recall } = await loadFixture(fixture);
    const calls = [
      () => contract.getBatch("missing"), () => contract.getPendingTransfer("missing"),
      () => contract.getTransferHistory("missing"), () => contract.getTransferHistoryCount("missing"),
      () => contract.getTransferHistoryEntry("missing", 0), () => contract.isBatchExpired("missing"),
      () => contract.connect(manufacturer).initiateTransfer("missing", distributor.address),
      () => contract.connect(distributor).confirmTransfer("missing", 1),
      () => contract.connect(manufacturer).cancelTransfer("missing", 1),
      () => contract.connect(recall).recallBatch("missing", "Recall"),
    ];
    for (const call of calls) await expect(call()).to.be.revertedWithCustomError(contract, "BatchNotFound").withArgs("missing");
  });
});
