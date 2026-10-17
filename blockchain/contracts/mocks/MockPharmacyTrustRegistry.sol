// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/** @dev Test-only trust registry for exercising V2 fail-closed query handling. */
contract MockPharmacyTrustRegistry {
    enum FailureMode {
        NONE,
        REVERT_REGISTRATION,
        MALFORMED_REGISTRATION,
        REVERT_SCORE,
        MALFORMED_SCORE,
        REVERT_TRUST,
        MALFORMED_TRUST
    }

    bool private immutable _registered;
    uint256 private immutable _trustScore;
    bool private immutable _trusted;
    FailureMode private immutable _failureMode;

    constructor(bool registered, uint256 trustScore, bool trusted, FailureMode failureMode) {
        _registered = registered;
        _trustScore = trustScore;
        _trusted = trusted;
        _failureMode = failureMode;
    }

    function isPharmacyRegistered(address) external view returns (bool) {
        if (_failureMode == FailureMode.REVERT_REGISTRATION) revert("registration unavailable");
        if (_failureMode == FailureMode.MALFORMED_REGISTRATION) {
            assembly {
                mstore(0, 2)
                return(0, 32)
            }
        }
        return _registered;
    }

    function getTrustScore(address) external view returns (uint256) {
        if (_failureMode == FailureMode.REVERT_SCORE) revert("score unavailable");
        if (_failureMode == FailureMode.MALFORMED_SCORE) {
            assembly {
                return(0, 31)
            }
        }
        return _trustScore;
    }

    function isPharmacyTrusted(address) external view returns (bool) {
        if (_failureMode == FailureMode.REVERT_TRUST) revert("trust status unavailable");
        if (_failureMode == FailureMode.MALFORMED_TRUST) {
            assembly {
                mstore(0, 2)
                return(0, 32)
            }
        }
        return _trusted;
    }
}
