const { expect } = require("chai");
const { ethers } = require("hardhat");

// Enum ordinals as declared in PharmacyTrustAnchor.sol.
const Status = { NONE: 0, ASSESSABLE: 1, NOT_ASSESSABLE: 2 };
const Tier = { NONE: 0, HIGHLY_TRUSTED: 1, TRUSTED: 2, UNDER_REVIEW: 3, ESCALATION_ALERT: 4 };
const Reason = { CRITICAL_FINDING: 0, ESCALATION_ALERT_TIER: 1, BOTH: 2 };

// Synthetic test identifiers only; pharmacyKey = keccak256(utf8(pharmacy code)).
const KEY = ethers.id("C3-TEST-PHARMACY-001");
const OTHER_KEY = ethers.id("C3-TEST-PHARMACY-002");
const hash = label => ethers.sha256(ethers.toUtf8Bytes(label));

describe("Component 3: PharmacyTrustAnchor", function () {
  let anchor;
  let admin;
  let anchorer;
  let outsider;

  beforeEach(async function () {
    [admin, anchorer, outsider] = await ethers.getSigners();
    anchor = await ethers.deployContract("PharmacyTrustAnchor", [admin.address]);
    await anchor.waitForDeployment();
  });

  it("assigns admin and anchorer roles to the configured admin", async function () {
    expect(await anchor.hasRole(await anchor.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
    expect(await anchor.hasRole(await anchor.ANCHORER_ROLE(), admin.address)).to.equal(true);
    expect(await anchor.hasRole(await anchor.ANCHORER_ROLE(), anchorer.address)).to.equal(false);
  });

  it("gates both anchoring functions on ANCHORER_ROLE", async function () {
    const role = await anchor.ANCHORER_ROLE();
    await expect(anchor.connect(outsider).anchorAssessment(KEY, hash("a"), 72334, false))
      .to.be.revertedWithCustomError(anchor, "AccessControlUnauthorizedAccount")
      .withArgs(outsider.address, role);
    await expect(anchor.connect(outsider).anchorNotAssessable(KEY, hash("a"), false))
      .to.be.revertedWithCustomError(anchor, "AccessControlUnauthorizedAccount")
      .withArgs(outsider.address, role);

    await anchor.grantRole(role, anchorer.address);
    await anchor.connect(anchorer).anchorAssessment(KEY, hash("b"), 72334, false);
    const [, record] = await anchor.getLatest(KEY);
    expect(record.anchorer).to.equal(anchorer.address);

    await anchor.revokeRole(role, anchorer.address);
    await expect(anchor.connect(anchorer).anchorAssessment(KEY, hash("c"), 72334, false))
      .to.be.revertedWithCustomError(anchor, "AccessControlUnauthorizedAccount")
      .withArgs(anchorer.address, role);
  });

  it("rejects scores above 100000 and accepts the 100000 maximum", async function () {
    await expect(anchor.anchorAssessment(KEY, hash("a"), 100001, false))
      .to.be.revertedWithCustomError(anchor, "ScoreOutOfRange")
      .withArgs(100001);
    await expect(anchor.tierFor(100001)).to.be.revertedWithCustomError(anchor, "ScoreOutOfRange");
    await anchor.anchorAssessment(KEY, hash("max"), 100000, false);
    const [, record] = await anchor.getLatest(KEY);
    expect(record.scoreMilli).to.equal(100000);
    expect(record.tier).to.equal(Tier.HIGHLY_TRUSTED);
  });

  it("rejects a zero pharmacyKey and a zero assessment hash", async function () {
    await expect(anchor.anchorAssessment(ethers.ZeroHash, hash("a"), 50000, false))
      .to.be.revertedWithCustomError(anchor, "ZeroPharmacyKey");
    await expect(anchor.anchorAssessment(KEY, ethers.ZeroHash, 50000, false))
      .to.be.revertedWithCustomError(anchor, "ZeroAssessmentHash");
    await expect(anchor.anchorNotAssessable(ethers.ZeroHash, hash("a"), false))
      .to.be.revertedWithCustomError(anchor, "ZeroPharmacyKey");
    await expect(anchor.anchorNotAssessable(KEY, ethers.ZeroHash, false))
      .to.be.revertedWithCustomError(anchor, "ZeroAssessmentHash");
    expect(await anchor.exists(KEY)).to.equal(false);
  });

  it("returns exists = false and no default score, tier or trust for unknown pharmacies", async function () {
    const [exists, record] = await anchor.getLatest(OTHER_KEY);
    expect(exists).to.equal(false);
    expect(record.status).to.equal(Status.NONE);
    expect(record.tier).to.equal(Tier.NONE);
    expect(record.version).to.equal(0);
    expect(record.assessmentHash).to.equal(ethers.ZeroHash);
    const [available, scoreMilli] = await anchor.getScore(OTHER_KEY);
    expect(available).to.equal(false);
    expect(scoreMilli).to.equal(0);
    expect(await anchor.exists(OTHER_KEY)).to.equal(false);
    expect(await anchor.latestVersion(OTHER_KEY)).to.equal(0);
    // No legacy-style trust getters with fail-open defaults exist on this contract.
    expect(anchor.interface.getFunction("getTrustScore", [])).to.equal(null);
    expect(anchor.interface.getFunction("isPharmacyTrusted", [])).to.equal(null);
  });

  it("stores a score of 0 as ASSESSABLE, distinct from NOT_ASSESSABLE", async function () {
    await expect(anchor.anchorAssessment(KEY, hash("zero"), 0, false))
      .to.emit(anchor, "AssessmentAnchored")
      .withArgs(KEY, 1, Status.ASSESSABLE, 0, Tier.ESCALATION_ALERT, hash("zero"), false);
    const [exists, record] = await anchor.getLatest(KEY);
    expect(exists).to.equal(true);
    expect(record.status).to.equal(Status.ASSESSABLE);
    expect(record.tier).to.equal(Tier.ESCALATION_ALERT);
    const [available, scoreMilli] = await anchor.getScore(KEY);
    expect(available).to.equal(true);
    expect(scoreMilli).to.equal(0);
  });

  it("stores NOT_ASSESSABLE with no score and no tier", async function () {
    await anchor.anchorAssessment(KEY, hash("scored"), 90000, false);
    await expect(anchor.anchorNotAssessable(KEY, hash("missing"), false))
      .to.emit(anchor, "AssessmentAnchored")
      .withArgs(KEY, 2, Status.NOT_ASSESSABLE, 0, Tier.NONE, hash("missing"), false);
    const [exists, record] = await anchor.getLatest(KEY);
    expect(exists).to.equal(true);
    expect(record.status).to.equal(Status.NOT_ASSESSABLE);
    expect(record.tier).to.equal(Tier.NONE);
    expect(record.scoreMilli).to.equal(0);
    const [available] = await anchor.getScore(KEY);
    expect(available).to.equal(false);
  });

  it("derives prototype tiers on-chain at the exact boundaries", async function () {
    const cases = [
      [80000, Tier.HIGHLY_TRUSTED],
      [79999, Tier.TRUSTED],
      [60000, Tier.TRUSTED],
      [59999, Tier.UNDER_REVIEW],
      [40000, Tier.UNDER_REVIEW],
      [39999, Tier.ESCALATION_ALERT],
    ];
    for (const [scoreMilli, tier] of cases) {
      expect(await anchor.tierFor(scoreMilli)).to.equal(tier);
      await anchor.anchorAssessment(KEY, hash(`b${scoreMilli}`), scoreMilli, false);
      const [, record] = await anchor.getLatest(KEY);
      expect(record.scoreMilli).to.equal(scoreMilli);
      expect(record.tier).to.equal(tier);
    }
  });

  it("increments versions per pharmacy and keeps every earlier version recoverable from events", async function () {
    const anchors = [
      { scoreMilli: 72334, label: "v1", critical: false },
      { scoreMilli: 81000, label: "v2", critical: true },
      { scoreMilli: null, label: "v3", critical: false },
    ];
    for (const item of anchors) {
      if (item.scoreMilli === null) await anchor.anchorNotAssessable(KEY, hash(item.label), item.critical);
      else await anchor.anchorAssessment(KEY, hash(item.label), item.scoreMilli, item.critical);
    }
    await anchor.anchorAssessment(OTHER_KEY, hash("other"), 50000, false);

    expect(await anchor.latestVersion(KEY)).to.equal(3);
    expect(await anchor.latestVersion(OTHER_KEY)).to.equal(1);
    const [, latest] = await anchor.getLatest(KEY);
    expect(latest.version).to.equal(3);
    expect(latest.assessmentHash).to.equal(hash("v3"));

    const events = await anchor.queryFilter(anchor.filters.AssessmentAnchored(KEY));
    expect(events.map(event => event.args.version)).to.deep.equal([1n, 2n, 3n]);
    expect(events.map(event => event.args.assessmentHash)).to.deep.equal([hash("v1"), hash("v2"), hash("v3")]);
    expect(events[0].args.scoreMilli).to.equal(72334);
    expect(events[0].args.tier).to.equal(Tier.TRUSTED);
    expect(events[1].args.scoreMilli).to.equal(81000);
    expect(events[1].args.criticalEscalationRequired).to.equal(true);
    expect(events[2].args.status).to.equal(Status.NOT_ASSESSABLE);
  });

  it("raises an escalation for a critical finding even with a high score, without changing the score or tier", async function () {
    await expect(anchor.anchorAssessment(KEY, hash("critical-high"), 93500, true))
      .to.emit(anchor, "EscalationRaised")
      .withArgs(KEY, 1, hash("critical-high"), Reason.CRITICAL_FINDING);
    const [, record] = await anchor.getLatest(KEY);
    expect(record.scoreMilli).to.equal(93500);
    expect(record.tier).to.equal(Tier.HIGHLY_TRUSTED);
    expect(record.criticalEscalationRequired).to.equal(true);
  });

  it("raises an escalation for the ESCALATION_ALERT tier and for both reasons together", async function () {
    await expect(anchor.anchorAssessment(KEY, hash("low"), 39999, false))
      .to.emit(anchor, "EscalationRaised")
      .withArgs(KEY, 1, hash("low"), Reason.ESCALATION_ALERT_TIER);
    await expect(anchor.anchorAssessment(KEY, hash("low-critical"), 10000, true))
      .to.emit(anchor, "EscalationRaised")
      .withArgs(KEY, 2, hash("low-critical"), Reason.BOTH);
  });

  it("raises an escalation for a critical finding on a NOT_ASSESSABLE assessment", async function () {
    await expect(anchor.anchorNotAssessable(KEY, hash("na-critical"), true))
      .to.emit(anchor, "EscalationRaised")
      .withArgs(KEY, 1, hash("na-critical"), Reason.CRITICAL_FINDING);
  });

  it("does not raise an escalation in the normal case", async function () {
    await expect(anchor.anchorAssessment(KEY, hash("normal"), 72334, false)).not.to.emit(anchor, "EscalationRaised");
    await expect(anchor.anchorAssessment(KEY, hash("boundary"), 40000, false)).not.to.emit(anchor, "EscalationRaised");
    await expect(anchor.anchorNotAssessable(KEY, hash("na"), false)).not.to.emit(anchor, "EscalationRaised");
  });

  it("treats escalation as a signal only: anchoring continues and no restricting function exists", async function () {
    await anchor.anchorAssessment(KEY, hash("escalated"), 20000, true);
    await anchor.anchorAssessment(KEY, hash("after"), 85000, false);
    const [, record] = await anchor.getLatest(KEY);
    expect(record.version).to.equal(2);
    expect(record.tier).to.equal(Tier.HIGHLY_TRUSTED);

    const ownFunctions = anchor.interface.fragments
      .filter(fragment => fragment.type === "function")
      .map(fragment => fragment.name)
      .filter(name => !["DEFAULT_ADMIN_ROLE", "getRoleAdmin", "grantRole", "hasRole", "renounceRole", "revokeRole", "supportsInterface"].includes(name))
      .sort();
    expect(ownFunctions).to.deep.equal([
      "ANCHORER_ROLE",
      "HIGHLY_TRUSTED_MIN_MILLI",
      "MAX_SCORE_MILLI",
      "TRUSTED_MIN_MILLI",
      "UNDER_REVIEW_MIN_MILLI",
      "anchorAssessment",
      "anchorNotAssessable",
      "exists",
      "getLatest",
      "getScore",
      "latestVersion",
      "tierFor",
    ]);
  });

  it("exposes the proposed prototype thresholds", async function () {
    expect(await anchor.MAX_SCORE_MILLI()).to.equal(100000);
    expect(await anchor.HIGHLY_TRUSTED_MIN_MILLI()).to.equal(80000);
    expect(await anchor.TRUSTED_MIN_MILLI()).to.equal(60000);
    expect(await anchor.UNDER_REVIEW_MIN_MILLI()).to.equal(40000);
  });
});
