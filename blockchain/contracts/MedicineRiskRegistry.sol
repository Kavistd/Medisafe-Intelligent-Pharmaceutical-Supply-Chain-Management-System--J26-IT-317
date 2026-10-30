// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title MedicineRiskRegistry
 * @notice Component 2: AI-based Risk Scoring Registry
 */
contract MedicineRiskRegistry is AccessControl {
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    struct BatchRisk {
        string batchId;
        uint256 riskScore; // 0 - 100
        bool isSafe;
        uint256 evaluatedAt;
        bool exists;
    }

    mapping(string => BatchRisk) private _batchRisks;

    event BatchRiskUpdated(string indexed batchId, uint256 riskScore, bool isSafe, uint256 timestamp);

    error RiskScoreOutOfRange(uint256 riskScore);
    error RiskSafetyFlagMismatch(uint256 riskScore, bool isSafe);

    constructor(address admin) {
        address initialAdmin = admin == address(0) ? msg.sender : admin;
        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        _grantRole(ORACLE_ROLE, initialAdmin);
    }

    function setBatchRisk(string calldata batchId, uint256 riskScore, bool isSafe) external onlyRole(ORACLE_ROLE) {
        if (riskScore > 100) revert RiskScoreOutOfRange(riskScore);
        if (isSafe != (riskScore < 70)) revert RiskSafetyFlagMismatch(riskScore, isSafe);

        _batchRisks[batchId] = BatchRisk({
            batchId: batchId,
            riskScore: riskScore,
            isSafe: isSafe,
            evaluatedAt: block.timestamp,
            exists: true
        });
        emit BatchRiskUpdated(batchId, riskScore, isSafe, block.timestamp);
    }

    function getRiskScore(string calldata batchId) external view returns (uint256) {
        return _batchRisks[batchId].riskScore;
    }

    function hasBatchRisk(string calldata batchId) external view returns (bool) {
        return _batchRisks[batchId].exists;
    }

    function isBatchSafe(string calldata batchId) external view returns (bool) {
        if (!_batchRisks[batchId].exists) {
            return true;
        }
        return _batchRisks[batchId].isSafe;
    }
}
