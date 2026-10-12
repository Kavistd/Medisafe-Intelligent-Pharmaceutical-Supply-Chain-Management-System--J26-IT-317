// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MedicineRiskRegistry {
    address public immutable administrator;
    mapping(address => bool) public authorizedScorers;

    struct RiskRecord {
        uint16 scoreBps; // 0-10,000 maps to 0.0000-1.0000
        string explanationHash; // IPFS CID or content hash; detailed SHAP data stays off-chain
        uint64 assessedAt;
        address scorer;
    }

    mapping(string => RiskRecord) private riskRecords;
    event ScorerAuthorizationUpdated(address indexed scorer, bool authorized);
    event RiskRecorded(string indexed batchId, uint16 scoreBps, string explanationHash, address indexed scorer, uint64 assessedAt);

    modifier onlyAdministrator() { require(msg.sender == administrator, "Administrator only"); _; }
    modifier onlyAuthorizedScorer() { require(authorizedScorers[msg.sender], "Scorer not authorized"); _; }

    constructor() { administrator = msg.sender; authorizedScorers[msg.sender] = true; }

    function setAuthorizedScorer(address scorer, bool authorized) external onlyAdministrator {
        require(scorer != address(0), "Invalid scorer");
        authorizedScorers[scorer] = authorized;
        emit ScorerAuthorizationUpdated(scorer, authorized);
    }

    function recordRisk(string calldata batchId, uint16 scoreBps, string calldata explanationHash) external onlyAuthorizedScorer {
        require(bytes(batchId).length > 0, "Batch ID required");
        require(scoreBps <= 10_000, "Score exceeds 1");
        riskRecords[batchId] = RiskRecord(scoreBps, explanationHash, uint64(block.timestamp), msg.sender);
        emit RiskRecorded(batchId, scoreBps, explanationHash, msg.sender, uint64(block.timestamp));
    }

    function getRisk(string calldata batchId) external view returns (RiskRecord memory) { return riskRecords[batchId]; }
}
