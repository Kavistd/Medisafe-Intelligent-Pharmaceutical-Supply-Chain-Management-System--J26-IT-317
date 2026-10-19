// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

/** @dev Component 2 interface. Kept local to V2; Component 2 is not modified. */
interface IMedicineRiskRegistryV2 {
    function hasBatchRisk(string calldata batchId) external view returns (bool);
    function getRiskScore(string calldata batchId) external view returns (uint256);
    function isBatchSafe(string calldata batchId) external view returns (bool);
}

/** @dev V2-local Component 3 interface; V1's separate interface stays unchanged. */
interface IPharmacyTrustV2 {
    function isPharmacyRegistered(address pharmacyAddress) external view returns (bool);
    function getTrustScore(address pharmacyAddress) external view returns (uint256);
    function isPharmacyTrusted(address pharmacyAddress) external view returns (bool);
}

/**
 * @title PrescriptionRegistryV2
 * @notice Isolated Component 4 V2 prescription lifecycle foundation.
 * @dev This phase deliberately has no credential verifier. Dispensing always
 * fails closed with PatientAuthorizationUnavailable until a genuine-ZK
 * construction and its compatible verifier are selected and validated.
 * Prescription IDs are opaque and must be generated independently of patient
 * data by the caller. This contract accepts no patient-derived values.
 */
contract PrescriptionRegistryV2 is AccessControl {
    bytes32 public constant DOCTOR_ROLE = keccak256("DOCTOR_ROLE");
    bytes32 public constant PHARMACY_ROLE = keccak256("PHARMACY_ROLE");

    enum PrescriptionStatus {
        ACTIVE,
        USED,
        EXPIRED,
        REVOKED
    }

    struct Prescription {
        bytes32 prescriptionId;
        string medicineId;
        string batchId;
        address doctorAddress;
        address intendedPharmacy;
        uint256 issuedAt;
        uint256 expiryTime;
        PrescriptionStatus status;
    }

    IMedicineRiskRegistryV2 public riskRegistry;
    IPharmacyTrustV2 public pharmacyTrustRegistry;

    uint256 public maxAllowedRiskScore = 69;
    uint256 public minRequiredTrustScore = 70;

    mapping(bytes32 => Prescription) private _prescriptions;
    bytes32[] private _allPrescriptionIds;
    mapping(address => bytes32[]) private _doctorPrescriptions;

    event PrescriptionIssued(
        bytes32 indexed prescriptionId,
        address indexed doctorAddress,
        address indexed intendedPharmacy,
        string medicineId,
        string batchId,
        uint256 issuedAt,
        uint256 expiryTime
    );
    event PrescriptionRevoked(
        bytes32 indexed prescriptionId,
        address indexed revokedBy,
        uint256 revokedAt
    );
    event PrescriptionStatusChanged(
        bytes32 indexed prescriptionId,
        PrescriptionStatus newStatus,
        uint256 timestamp
    );
    event RiskRegistryUpdated(address indexed oldAddress, address indexed newAddress);
    event PharmacyTrustUpdated(address indexed oldAddress, address indexed newAddress);
    event RiskThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);
    event TrustThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);

    error PrescriptionNotFound(bytes32 prescriptionId);
    error PrescriptionAlreadyExists(bytes32 prescriptionId);
    error InvalidPrescriptionId();
    error InvalidIntendedPharmacy();
    error InvalidExpiryTime(uint256 expiryTime, uint256 currentTimestamp);
    error EmptyMedicineId();
    error EmptyBatchId();
    error PrescriptionNotActive(bytes32 prescriptionId, PrescriptionStatus currentStatus);
    error PrescriptionNotExpired(bytes32 prescriptionId, uint256 expiryTime, uint256 currentTimestamp);
    error WrongIntendedPharmacy(address expected, address caller);
    error PatientAuthorizationUnavailable();
    error RiskRegistryNotConfigured();
    error RiskRegistryUnavailable();
    error RiskRecordNotFound(string batchId);
    error RiskScoreOutOfRange(string batchId, uint256 riskScore);
    error RiskSafetyFlagMismatch(string batchId, uint256 riskScore, bool isSafe);
    error HighMedicineRisk(string batchId, uint256 riskScore, uint256 maxAllowed);
    error InvalidRiskThreshold(uint256 maxAllowed);
    error PharmacyTrustRegistryUnavailable();
    error PharmacyNotRegistered(address pharmacy);
    error LowPharmacyTrust(address pharmacy, uint256 trustScore, uint256 minRequired);
    error PharmacyNotTrusted(address pharmacy);

    constructor(address admin, address riskRegistryAddress, address pharmacyTrustRegistryAddress) {
        address initialAdmin = admin == address(0) ? msg.sender : admin;
        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);

        if (riskRegistryAddress != address(0)) {
            riskRegistry = IMedicineRiskRegistryV2(riskRegistryAddress);
        }
        if (pharmacyTrustRegistryAddress != address(0)) {
            pharmacyTrustRegistry = IPharmacyTrustV2(pharmacyTrustRegistryAddress);
        }
    }

    /**
     * @notice Creates a prescription using a caller-generated, patient-independent ID.
     * @dev The contract does not derive IDs from patient data and receives no such data.
     */
    function issuePrescription(
        bytes32 prescriptionId,
        string calldata medicineId,
        string calldata batchId,
        address intendedPharmacy,
        uint256 expiryTime
    ) external onlyRole(DOCTOR_ROLE) {
        if (prescriptionId == bytes32(0)) revert InvalidPrescriptionId();
        if (intendedPharmacy == address(0)) revert InvalidIntendedPharmacy();
        if (expiryTime <= block.timestamp) revert InvalidExpiryTime(expiryTime, block.timestamp);
        if (_prescriptions[prescriptionId].prescriptionId != bytes32(0)) {
            revert PrescriptionAlreadyExists(prescriptionId);
        }
        if (bytes(medicineId).length == 0) revert EmptyMedicineId();
        if (bytes(batchId).length == 0) revert EmptyBatchId();

        _prescriptions[prescriptionId] = Prescription({
            prescriptionId: prescriptionId,
            medicineId: medicineId,
            batchId: batchId,
            doctorAddress: msg.sender,
            intendedPharmacy: intendedPharmacy,
            issuedAt: block.timestamp,
            expiryTime: expiryTime,
            status: PrescriptionStatus.ACTIVE
        });
        _allPrescriptionIds.push(prescriptionId);
        _doctorPrescriptions[msg.sender].push(prescriptionId);

        emit PrescriptionIssued(
            prescriptionId,
            msg.sender,
            intendedPharmacy,
            medicineId,
            batchId,
            block.timestamp,
            expiryTime
        );
    }

    /**
     * @notice Dispensing remains unavailable until a genuine-ZK verifier is integrated.
     * @dev Lifecycle and pharmacy/risk policy checks run first; this function then
     * always reverts, so it cannot mark a prescription USED in this phase.
     */
    function dispensePrescription(bytes32 prescriptionId) external onlyRole(PHARMACY_ROLE) {
        Prescription storage prescription = _prescriptions[prescriptionId];
        if (prescription.prescriptionId == bytes32(0)) revert PrescriptionNotFound(prescriptionId);

        PrescriptionStatus currentStatus = _effectiveStatus(prescription);
        if (currentStatus != PrescriptionStatus.ACTIVE) {
            revert PrescriptionNotActive(prescriptionId, currentStatus);
        }
        if (msg.sender != prescription.intendedPharmacy) {
            revert WrongIntendedPharmacy(prescription.intendedPharmacy, msg.sender);
        }

        _checkRisk(prescription.batchId);
        _checkPharmacyTrust(msg.sender);

        revert PatientAuthorizationUnavailable();
    }

    /** @notice The issuing doctor or an administrator may revoke an active prescription. */
    function revokePrescription(bytes32 prescriptionId) external {
        Prescription storage prescription = _prescriptions[prescriptionId];
        if (prescription.prescriptionId == bytes32(0)) revert PrescriptionNotFound(prescriptionId);

        if (msg.sender != prescription.doctorAddress && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert AccessControlUnauthorizedAccount(msg.sender, DEFAULT_ADMIN_ROLE);
        }

        PrescriptionStatus currentStatus = _effectiveStatus(prescription);
        if (currentStatus != PrescriptionStatus.ACTIVE) {
            revert PrescriptionNotActive(prescriptionId, currentStatus);
        }

        prescription.status = PrescriptionStatus.REVOKED;
        emit PrescriptionRevoked(prescriptionId, msg.sender, block.timestamp);
        emit PrescriptionStatusChanged(prescriptionId, PrescriptionStatus.REVOKED, block.timestamp);
    }

    /** @notice Anyone may finalize an active prescription after its expiry time. */
    function expirePrescription(bytes32 prescriptionId) external {
        Prescription storage prescription = _prescriptions[prescriptionId];
        if (prescription.prescriptionId == bytes32(0)) revert PrescriptionNotFound(prescriptionId);

        if (prescription.status != PrescriptionStatus.ACTIVE) {
            revert PrescriptionNotActive(prescriptionId, prescription.status);
        }
        if (block.timestamp < prescription.expiryTime) {
            revert PrescriptionNotExpired(prescriptionId, prescription.expiryTime, block.timestamp);
        }

        prescription.status = PrescriptionStatus.EXPIRED;
        emit PrescriptionStatusChanged(prescriptionId, PrescriptionStatus.EXPIRED, block.timestamp);
    }

    function getPrescription(bytes32 prescriptionId) external view returns (Prescription memory prescription) {
        prescription = _prescriptions[prescriptionId];
        if (prescription.prescriptionId == bytes32(0)) revert PrescriptionNotFound(prescriptionId);
        prescription.status = _effectiveStatus(prescription);
    }

    function getTotalPrescriptions() external view returns (uint256) {
        return _allPrescriptionIds.length;
    }

    function getAllPrescriptionIds() external view returns (bytes32[] memory) {
        return _allPrescriptionIds;
    }

    function getPrescriptionsByDoctor(address doctor) external view returns (bytes32[] memory) {
        return _doctorPrescriptions[doctor];
    }

    function setRiskRegistry(address riskRegistryAddress) external onlyRole(DEFAULT_ADMIN_ROLE) {
        address oldAddress = address(riskRegistry);
        riskRegistry = IMedicineRiskRegistryV2(riskRegistryAddress);
        emit RiskRegistryUpdated(oldAddress, riskRegistryAddress);
    }

    function setPharmacyTrustRegistry(address pharmacyTrustRegistryAddress) external onlyRole(DEFAULT_ADMIN_ROLE) {
        address oldAddress = address(pharmacyTrustRegistry);
        pharmacyTrustRegistry = IPharmacyTrustV2(pharmacyTrustRegistryAddress);
        emit PharmacyTrustUpdated(oldAddress, pharmacyTrustRegistryAddress);
    }

    function setRiskThreshold(uint256 maxAllowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (maxAllowed >= 70) revert InvalidRiskThreshold(maxAllowed);
        uint256 oldThreshold = maxAllowedRiskScore;
        maxAllowedRiskScore = maxAllowed;
        emit RiskThresholdUpdated(oldThreshold, maxAllowed);
    }

    function setTrustThreshold(uint256 minRequired) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 oldThreshold = minRequiredTrustScore;
        minRequiredTrustScore = minRequired;
        emit TrustThresholdUpdated(oldThreshold, minRequired);
    }

    function _effectiveStatus(Prescription memory prescription) internal view returns (PrescriptionStatus) {
        if (
            prescription.status == PrescriptionStatus.ACTIVE &&
            block.timestamp >= prescription.expiryTime
        ) {
            return PrescriptionStatus.EXPIRED;
        }
        return prescription.status;
    }

    function _checkRisk(string storage batchId) internal view {
        address registryAddress = address(riskRegistry);
        if (registryAddress == address(0)) revert RiskRegistryNotConfigured();
        if (registryAddress.code.length == 0) revert RiskRegistryUnavailable();
        if (!riskRegistry.hasBatchRisk(batchId)) revert RiskRecordNotFound(batchId);

        uint256 riskScore = riskRegistry.getRiskScore(batchId);
        if (riskScore > 100) revert RiskScoreOutOfRange(batchId, riskScore);

        bool isSafe = riskRegistry.isBatchSafe(batchId);
        if (isSafe != (riskScore < 70)) {
            revert RiskSafetyFlagMismatch(batchId, riskScore, isSafe);
        }
        if (riskScore > maxAllowedRiskScore) {
            revert HighMedicineRisk(batchId, riskScore, maxAllowedRiskScore);
        }
    }

    function _checkPharmacyTrust(address pharmacy) internal view {
        address registryAddress = address(pharmacyTrustRegistry);
        if (registryAddress == address(0)) revert PharmacyTrustRegistryUnavailable();
        if (registryAddress.code.length == 0) revert PharmacyTrustRegistryUnavailable();
        if (!pharmacyTrustRegistry.isPharmacyRegistered(pharmacy)) {
            revert PharmacyNotRegistered(pharmacy);
        }

        uint256 trustScore = pharmacyTrustRegistry.getTrustScore(pharmacy);
        if (trustScore < minRequiredTrustScore) {
            revert LowPharmacyTrust(pharmacy, trustScore, minRequiredTrustScore);
        }
        if (!pharmacyTrustRegistry.isPharmacyTrusted(pharmacy)) revert PharmacyNotTrusted(pharmacy);
    }
}
