// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/** Test double for defensive Component 4 risk-registry checks. */
contract MockMedicineRiskRegistry {
    bool private immutable _recordExists;
    uint256 private immutable _riskScore;
    bool private immutable _isSafe;
    bool private immutable _revertOnHasBatchRisk;
    bool private immutable _revertOnGetRiskScore;
    bool private immutable _revertOnIsBatchSafe;

    error MockHasBatchRiskFailed();
    error MockRiskScoreReadFailed();
    error MockRiskSafetyReadFailed();

    constructor(
        bool recordExists,
        uint256 riskScore,
        bool isSafe,
        bool revertOnHasBatchRisk,
        bool revertOnGetRiskScore,
        bool revertOnIsBatchSafe
    ) {
        _recordExists = recordExists;
        _riskScore = riskScore;
        _isSafe = isSafe;
        _revertOnHasBatchRisk = revertOnHasBatchRisk;
        _revertOnGetRiskScore = revertOnGetRiskScore;
        _revertOnIsBatchSafe = revertOnIsBatchSafe;
    }

    function hasBatchRisk(string calldata) external view returns (bool) {
        if (_revertOnHasBatchRisk) revert MockHasBatchRiskFailed();
        return _recordExists;
    }

    function getRiskScore(string calldata) external view returns (uint256) {
        if (_revertOnGetRiskScore) revert MockRiskScoreReadFailed();
        return _riskScore;
    }

    function isBatchSafe(string calldata) external view returns (bool) {
        if (_revertOnIsBatchSafe) revert MockRiskSafetyReadFailed();
        return _isSafe;
    }
}
