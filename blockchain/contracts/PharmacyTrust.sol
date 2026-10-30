// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title PharmacyTrust
 * @notice Component 3: Pharmacy Trust and Verification Registry
 */
contract PharmacyTrust is AccessControl {
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");

    struct PharmacyProfile {
        address pharmacyAddress;
        uint256 trustScore; // 0 - 100
        bool isTrusted;
        uint256 lastUpdated;
    }

    mapping(address => PharmacyProfile) private _pharmacyProfiles;

    event PharmacyTrustScoreUpdated(address indexed pharmacy, uint256 trustScore, bool isTrusted, uint256 timestamp);

    constructor(address admin) {
        address initialAdmin = admin == address(0) ? msg.sender : admin;
        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        _grantRole(VERIFIER_ROLE, initialAdmin);
    }

    function setPharmacyTrust(address pharmacy, uint256 trustScore, bool isTrusted) external onlyRole(VERIFIER_ROLE) {
        _pharmacyProfiles[pharmacy] = PharmacyProfile({
            pharmacyAddress: pharmacy,
            trustScore: trustScore,
            isTrusted: isTrusted,
            lastUpdated: block.timestamp
        });
        emit PharmacyTrustScoreUpdated(pharmacy, trustScore, isTrusted, block.timestamp);
    }

    function getTrustScore(address pharmacyAddress) external view returns (uint256) {
        if (_pharmacyProfiles[pharmacyAddress].lastUpdated == 0) {
            return 100;
        }
        return _pharmacyProfiles[pharmacyAddress].trustScore;
    }

    function isPharmacyTrusted(address pharmacyAddress) external view returns (bool) {
        if (_pharmacyProfiles[pharmacyAddress].lastUpdated == 0) {
            return true;
        }
        return _pharmacyProfiles[pharmacyAddress].isTrusted;
    }
}
