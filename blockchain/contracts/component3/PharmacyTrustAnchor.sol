// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title PharmacyTrustAnchor
 * @notice Component 3: additive, fail-closed anchoring of off-chain pharmacy trust assessments.
 *
 * RESEARCH PROTOTYPE. The score weights (D 0.35, R 0.30, C 0.20, I 0.15) and the tier
 * thresholds below are proposed research parameters, NOT NMRA-prescribed values. A tier is
 * decision support, not a regulatory decision.
 *
 * Anchoring proves only that a given assessment hash was recorded by an authorised anchorer
 * at a given block time. It does NOT prove that the underlying evidence is true, complete or
 * correctly attributed.
 *
 * Identity: a pharmacy is identified only by bytes32 pharmacyKey = keccak256(utf8(pharmacy code)).
 * No wallet address, name or personal data is stored.
 *
 * Fail-closed: unknown pharmacies have exists = false and no default score, tier or trusted flag.
 * Escalation is a signal (event) only; no function blocks or restricts any pharmacy.
 *
 * This contract does not modify or replace the legacy PharmacyTrust registry.
 */
contract PharmacyTrustAnchor is AccessControl {
    bytes32 public constant ANCHORER_ROLE = keccak256("ANCHORER_ROLE");

    /// @dev Scores are encoded as score x 1000 (72.334 -> 72334).
    uint32 public constant MAX_SCORE_MILLI = 100000;
    /// @dev Proposed prototype thresholds (not NMRA values); mirror Component 3 classifyTier.
    uint32 public constant HIGHLY_TRUSTED_MIN_MILLI = 80000;
    uint32 public constant TRUSTED_MIN_MILLI = 60000;
    uint32 public constant UNDER_REVIEW_MIN_MILLI = 40000;

    enum Status {
        NONE,
        ASSESSABLE,
        NOT_ASSESSABLE
    }

    enum Tier {
        NONE,
        HIGHLY_TRUSTED,
        TRUSTED,
        UNDER_REVIEW,
        ESCALATION_ALERT
    }

    enum EscalationReason {
        CRITICAL_FINDING,
        ESCALATION_ALERT_TIER,
        CRITICAL_FINDING_AND_ESCALATION_ALERT_TIER
    }

    struct AnchorRecord {
        Status status;
        uint32 scoreMilli; // meaningful only when status == ASSESSABLE
        Tier tier; // NONE unless status == ASSESSABLE
        bytes32 assessmentHash;
        bool criticalEscalationRequired;
        uint64 version;
        uint64 blockTimestamp;
        address anchorer;
    }

    mapping(bytes32 => AnchorRecord) private _latest;

    event AssessmentAnchored(
        bytes32 indexed pharmacyKey,
        uint64 indexed version,
        Status status,
        uint32 scoreMilli,
        Tier tier,
        bytes32 assessmentHash,
        bool criticalEscalationRequired
    );

    event EscalationRaised(
        bytes32 indexed pharmacyKey,
        uint64 indexed version,
        bytes32 assessmentHash,
        EscalationReason reason
    );

    error ZeroPharmacyKey();
    error ZeroAssessmentHash();
    error ScoreOutOfRange(uint32 scoreMilli);

    constructor(address admin) {
        address initialAdmin = admin == address(0) ? msg.sender : admin;
        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        _grantRole(ANCHORER_ROLE, initialAdmin);
    }

    /// @notice Anchor an ASSESSABLE assessment. The tier is derived on-chain from scoreMilli.
    function anchorAssessment(
        bytes32 pharmacyKey,
        bytes32 assessmentHash,
        uint32 scoreMilli,
        bool criticalEscalationRequired
    ) external onlyRole(ANCHORER_ROLE) returns (uint64 version) {
        if (scoreMilli > MAX_SCORE_MILLI) revert ScoreOutOfRange(scoreMilli);
        return _anchor(
            pharmacyKey,
            assessmentHash,
            Status.ASSESSABLE,
            scoreMilli,
            tierFor(scoreMilli),
            criticalEscalationRequired
        );
    }

    /// @notice Anchor a NOT_ASSESSABLE assessment: no score and no tier are stored.
    function anchorNotAssessable(
        bytes32 pharmacyKey,
        bytes32 assessmentHash,
        bool criticalEscalationRequired
    ) external onlyRole(ANCHORER_ROLE) returns (uint64 version) {
        return _anchor(pharmacyKey, assessmentHash, Status.NOT_ASSESSABLE, 0, Tier.NONE, criticalEscalationRequired);
    }

    /// @notice Prototype tier for a score encoded as score x 1000.
    function tierFor(uint32 scoreMilli) public pure returns (Tier) {
        if (scoreMilli > MAX_SCORE_MILLI) revert ScoreOutOfRange(scoreMilli);
        if (scoreMilli >= HIGHLY_TRUSTED_MIN_MILLI) return Tier.HIGHLY_TRUSTED;
        if (scoreMilli >= TRUSTED_MIN_MILLI) return Tier.TRUSTED;
        if (scoreMilli >= UNDER_REVIEW_MIN_MILLI) return Tier.UNDER_REVIEW;
        return Tier.ESCALATION_ALERT;
    }

    /// @notice Latest record; exists = false (and an all-zero record) for unknown pharmacies.
    function getLatest(bytes32 pharmacyKey) external view returns (bool exists_, AnchorRecord memory record) {
        record = _latest[pharmacyKey];
        exists_ = record.version != 0;
    }

    /// @notice Score only when the latest record is ASSESSABLE; never a default value.
    function getScore(bytes32 pharmacyKey) external view returns (bool available, uint32 scoreMilli) {
        AnchorRecord storage record = _latest[pharmacyKey];
        if (record.status != Status.ASSESSABLE) return (false, 0);
        return (true, record.scoreMilli);
    }

    function exists(bytes32 pharmacyKey) external view returns (bool) {
        return _latest[pharmacyKey].version != 0;
    }

    function latestVersion(bytes32 pharmacyKey) external view returns (uint64) {
        return _latest[pharmacyKey].version;
    }

    function _anchor(
        bytes32 pharmacyKey,
        bytes32 assessmentHash,
        Status status,
        uint32 scoreMilli,
        Tier tier,
        bool criticalEscalationRequired
    ) private returns (uint64 version) {
        if (pharmacyKey == bytes32(0)) revert ZeroPharmacyKey();
        if (assessmentHash == bytes32(0)) revert ZeroAssessmentHash();

        version = _latest[pharmacyKey].version + 1;
        _latest[pharmacyKey] = AnchorRecord({
            status: status,
            scoreMilli: scoreMilli,
            tier: tier,
            assessmentHash: assessmentHash,
            criticalEscalationRequired: criticalEscalationRequired,
            version: version,
            blockTimestamp: uint64(block.timestamp),
            anchorer: msg.sender
        });

        // Every anchor is emitted with its full data, so earlier versions remain recoverable from logs.
        emit AssessmentAnchored(
            pharmacyKey,
            version,
            status,
            scoreMilli,
            tier,
            assessmentHash,
            criticalEscalationRequired
        );

        bool alertTier = tier == Tier.ESCALATION_ALERT;
        if (criticalEscalationRequired || alertTier) {
            EscalationReason reason = criticalEscalationRequired && alertTier
                ? EscalationReason.CRITICAL_FINDING_AND_ESCALATION_ALERT_TIER
                : criticalEscalationRequired
                    ? EscalationReason.CRITICAL_FINDING
                    : EscalationReason.ESCALATION_ALERT_TIER;
            emit EscalationRaised(pharmacyKey, version, assessmentHash, reason);
        }
    }
}
