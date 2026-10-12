// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title IMedicineRiskRegistry
 * @notice Interface for Component 2 (AI-based Risk Scoring)
 */
interface IMedicineRiskRegistry {
    function getRiskScore(string calldata batchId) external view returns (uint256);
    function isBatchSafe(string calldata batchId) external view returns (bool);
}

/**
 * @title IPharmacyTrust
 * @notice Interface for Component 3 (Pharmacy Trust & Verification)
 */
interface IPharmacyTrust {
    function getTrustScore(address pharmacyAddress) external view returns (uint256);
    function isPharmacyTrusted(address pharmacyAddress) external view returns (bool);
}

/**
 * @title PrescriptionRegistry
 * @author R.A.M.A. Ranasinghe (IT23142978) - Component 4
 * @notice Component 4: Privacy-Preserving Blockchain Prescription Management
 * @dev Manages prescription lifecycle on-chain using OpenZeppelin AccessControl and cryptographic patient identity hashes.
 * Ensures single-use dispensing and verifies Component 2 (Risk Score) and Component 3 (Pharmacy Trust Score).
 */
contract PrescriptionRegistry is AccessControl {
    // Roles
    bytes32 public constant DOCTOR_ROLE = keccak256("DOCTOR_ROLE");
    bytes32 public constant PHARMACY_ROLE = keccak256("PHARMACY_ROLE");

    // Status Enum
    enum PrescriptionStatus {
        ACTIVE,
        USED,
        EXPIRED,
        REVOKED
    }

    // Prescription Struct
    struct Prescription {
        bytes32 prescriptionId;
        bytes32 patientHash;
        string medicineId;
        string batchId;
        address doctorAddress;
        uint256 issuedAt;
        uint256 expiryTime;
        PrescriptionStatus status;
    }

    // External Registries (Component 2 & Component 3)
    IMedicineRiskRegistry public riskRegistry;
    IPharmacyTrust public pharmacyTrustRegistry;

    // Thresholds
    uint256 public maxAllowedRiskScore = 50;  // Batch risk score must be <= this value (0-100 scale)
    uint256 public minRequiredTrustScore = 70; // Pharmacy trust score must be >= this value (0-100 scale)

    // Storage
    mapping(bytes32 => Prescription) private _prescriptions;
    bytes32[] private _allPrescriptionIds;
    mapping(address => bytes32[]) private _doctorPrescriptions;

    // Events
    event PrescriptionIssued(
        bytes32 indexed prescriptionId,
        bytes32 indexed patientHash,
        string medicineId,
        string batchId,
        address indexed doctorAddress,
        uint256 expiryTime,
        uint256 issuedAt
    );

    event PrescriptionDispensed(
        bytes32 indexed prescriptionId,
        address indexed pharmacyAddress,
        bytes32 indexed patientHash,
        uint256 dispensedAt
    );

    event PrescriptionRevoked(
        bytes32 indexed prescriptionId,
        address indexed revokedBy,
        string reason,
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

    // Custom Errors
    error PrescriptionNotFound(bytes32 prescriptionId);
    error PrescriptionAlreadyExists(bytes32 prescriptionId);
    error InvalidPrescriptionId();
    error InvalidPatientHash();
    error InvalidExpiryTime(uint256 expiryTime, uint256 currentTimestamp);
    error PrescriptionNotActive(bytes32 prescriptionId, PrescriptionStatus currentStatus);
    error PrescriptionExpired(bytes32 prescriptionId, uint256 expiryTime, uint256 currentTimestamp);
    error PatientHashMismatch(bytes32 expected, bytes32 provided);
    error HighMedicineRisk(string batchId, uint256 riskScore, uint256 maxAllowed);
    error MedicineBatchUnsafe(string batchId);
    error LowPharmacyTrust(address pharmacy, uint256 trustScore, uint256 minRequired);
    error PharmacyNotTrusted(address pharmacy);
    error UnauthorizedRevoker(address caller, address doctor);

    /**
     * @notice Constructor sets admin and optional external registry contracts
     * @param admin Initial administrator address
     * @param _riskRegistry Address of Component 2 Medicine Risk Registry (can be address(0))
     * @param _pharmacyTrustRegistry Address of Component 3 Pharmacy Trust Registry (can be address(0))
     */
    constructor(
        address admin,
        address _riskRegistry,
        address _pharmacyTrustRegistry
    ) {
        address initialAdmin = admin == address(0) ? msg.sender : admin;
        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);

        if (_riskRegistry != address(0)) {
            riskRegistry = IMedicineRiskRegistry(_riskRegistry);
        }
        if (_pharmacyTrustRegistry != address(0)) {
            pharmacyTrustRegistry = IPharmacyTrust(_pharmacyTrustRegistry);
        }
    }

    /**
     * @notice Issues a new prescription on-chain with off-chain hashed patient identity
     * @dev Restricted to accounts with DOCTOR_ROLE
     * @param prescriptionId Unique identifier of the prescription
     * @param patientHash Off-chain keccak256 hash of patient identity + salt
     * @param medicineId Identifier/code of prescribed medicine
     * @param batchId Batch number of the medicine to be dispensed
     * @param expiryTime UNIX timestamp when prescription expires
     */
    function issuePrescription(
        bytes32 prescriptionId,
        bytes32 patientHash,
        string calldata medicineId,
        string calldata batchId,
        uint256 expiryTime
    ) external onlyRole(DOCTOR_ROLE) {
        if (prescriptionId == bytes32(0)) revert InvalidPrescriptionId();
        if (patientHash == bytes32(0)) revert InvalidPatientHash();
        if (expiryTime <= block.timestamp) revert InvalidExpiryTime(expiryTime, block.timestamp);
        if (_prescriptions[prescriptionId].prescriptionId != bytes32(0)) {
            revert PrescriptionAlreadyExists(prescriptionId);
        }
        require(bytes(medicineId).length > 0, "PrescriptionRegistry: medicineId cannot be empty");
        require(bytes(batchId).length > 0, "PrescriptionRegistry: batchId cannot be empty");

        _prescriptions[prescriptionId] = Prescription({
            prescriptionId: prescriptionId,
            patientHash: patientHash,
            medicineId: medicineId,
            batchId: batchId,
            doctorAddress: msg.sender,
            issuedAt: block.timestamp,
            expiryTime: expiryTime,
            status: PrescriptionStatus.ACTIVE
        });

        _allPrescriptionIds.push(prescriptionId);
        _doctorPrescriptions[msg.sender].push(prescriptionId);

        emit PrescriptionIssued(
            prescriptionId,
            patientHash,
            medicineId,
            batchId,
            msg.sender,
            expiryTime,
            block.timestamp
        );
    }

    /**
     * @notice Verifies and dispenses a prescription, enforcing single-use and external safety checks
     * @dev Restricted to accounts with PHARMACY_ROLE
     * @param prescriptionId Unique identifier of the prescription
     */
    function verifyAndDispense(bytes32 prescriptionId) external onlyRole(PHARMACY_ROLE) {
        _dispenseInternal(prescriptionId, bytes32(0), false);
    }

    /**
     * @notice Verifies patient hash and dispenses prescription, enforcing single-use and safety checks
     * @dev Restricted to accounts with PHARMACY_ROLE
     * @param prescriptionId Unique identifier of the prescription
     * @param presentedPatientHash Off-chain recomputed patient identity hash to verify against stored hash
     */
    function verifyAndDispenseWithPatientHash(
        bytes32 prescriptionId,
        bytes32 presentedPatientHash
    ) external onlyRole(PHARMACY_ROLE) {
        _dispenseInternal(prescriptionId, presentedPatientHash, true);
    }

    /**
     * @dev Internal function handling prescription verification, oracle checks, and status update
     */
    function _dispenseInternal(
        bytes32 prescriptionId,
        bytes32 presentedPatientHash,
        bool verifyPatient
    ) internal {
        Prescription storage p = _prescriptions[prescriptionId];
        if (p.prescriptionId == bytes32(0)) revert PrescriptionNotFound(prescriptionId);

        // Check if expired
        if (block.timestamp > p.expiryTime) {
            if (p.status == PrescriptionStatus.ACTIVE) {
                p.status = PrescriptionStatus.EXPIRED;
                emit PrescriptionStatusChanged(prescriptionId, PrescriptionStatus.EXPIRED, block.timestamp);
            }
            revert PrescriptionExpired(prescriptionId, p.expiryTime, block.timestamp);
        }

        // Enforce single-use: prescription must be ACTIVE
        if (p.status != PrescriptionStatus.ACTIVE) {
            revert PrescriptionNotActive(prescriptionId, p.status);
        }

        // Verify patient hash if requested
        if (verifyPatient) {
            if (p.patientHash != presentedPatientHash) {
                revert PatientHashMismatch(p.patientHash, presentedPatientHash);
            }
        }

        // Component 2 (AI Risk Scoring) Oracle Check
        if (address(riskRegistry) != address(0)) {
            uint256 riskScore = riskRegistry.getRiskScore(p.batchId);
            if (riskScore > maxAllowedRiskScore) {
                revert HighMedicineRisk(p.batchId, riskScore, maxAllowedRiskScore);
            }
            if (!riskRegistry.isBatchSafe(p.batchId)) {
                revert MedicineBatchUnsafe(p.batchId);
            }
        }

        // Component 3 (Pharmacy Trust Score) Oracle Check
        if (address(pharmacyTrustRegistry) != address(0)) {
            uint256 trustScore = pharmacyTrustRegistry.getTrustScore(msg.sender);
            if (trustScore < minRequiredTrustScore) {
                revert LowPharmacyTrust(msg.sender, trustScore, minRequiredTrustScore);
            }
            if (!pharmacyTrustRegistry.isPharmacyTrusted(msg.sender)) {
                revert PharmacyNotTrusted(msg.sender);
            }
        }

        // Mark as USED (single-use enforcement)
        p.status = PrescriptionStatus.USED;

        emit PrescriptionDispensed(
            prescriptionId,
            msg.sender,
            p.patientHash,
            block.timestamp
        );
        emit PrescriptionStatusChanged(prescriptionId, PrescriptionStatus.USED, block.timestamp);
    }

    /**
     * @notice Revokes an active prescription
     * @dev Can be called by the issuing doctor or an administrator
     * @param prescriptionId Unique identifier of the prescription
     * @param reason Human-readable revocation reason
     */
    function revokePrescription(
        bytes32 prescriptionId,
        string calldata reason
    ) external {
        Prescription storage p = _prescriptions[prescriptionId];
        if (p.prescriptionId == bytes32(0)) revert PrescriptionNotFound(prescriptionId);

        if (msg.sender != p.doctorAddress && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert UnauthorizedRevoker(msg.sender, p.doctorAddress);
        }

        if (p.status != PrescriptionStatus.ACTIVE) {
            revert PrescriptionNotActive(prescriptionId, p.status);
        }

        p.status = PrescriptionStatus.REVOKED;

        emit PrescriptionRevoked(prescriptionId, msg.sender, reason, block.timestamp);
        emit PrescriptionStatusChanged(prescriptionId, PrescriptionStatus.REVOKED, block.timestamp);
    }

    /**
     * @notice Retrieves prescription details by ID
     * @param prescriptionId Unique identifier of the prescription
     * @return Prescription struct with dynamically evaluated EXPIRED status if past expiry
     */
    function getPrescription(bytes32 prescriptionId) external view returns (Prescription memory) {
        Prescription memory p = _prescriptions[prescriptionId];
        if (p.prescriptionId == bytes32(0)) revert PrescriptionNotFound(prescriptionId);

        // If active but timestamp has passed expiry, return EXPIRED status
        if (p.status == PrescriptionStatus.ACTIVE && block.timestamp > p.expiryTime) {
            p.status = PrescriptionStatus.EXPIRED;
        }

        return p;
    }

    /**
     * @notice Verifies if a given patient hash matches the on-chain prescription
     * @param prescriptionId Unique identifier of the prescription
     * @param patientHash Off-chain hashed patient identity
     * @return bool True if hash matches exactly
     */
    function verifyPatientHash(bytes32 prescriptionId, bytes32 patientHash) external view returns (bool) {
        Prescription memory p = _prescriptions[prescriptionId];
        if (p.prescriptionId == bytes32(0)) return false;
        return p.patientHash == patientHash;
    }

    /**
     * @notice Gets total count of issued prescriptions
     */
    function getTotalPrescriptions() external view returns (uint256) {
        return _allPrescriptionIds.length;
    }

    /**
     * @notice Gets all prescription IDs
     */
    function getAllPrescriptionIds() external view returns (bytes32[] memory) {
        return _allPrescriptionIds;
    }

    /**
     * @notice Gets prescription IDs issued by a specific doctor
     */
    function getPrescriptionsByDoctor(address doctor) external view returns (bytes32[] memory) {
        return _doctorPrescriptions[doctor];
    }

    // --- Admin Configuration Functions ---

    function setRiskRegistry(address _riskRegistry) external onlyRole(DEFAULT_ADMIN_ROLE) {
        address old = address(riskRegistry);
        riskRegistry = IMedicineRiskRegistry(_riskRegistry);
        emit RiskRegistryUpdated(old, _riskRegistry);
    }

    function setPharmacyTrustRegistry(address _pharmacyTrustRegistry) external onlyRole(DEFAULT_ADMIN_ROLE) {
        address old = address(pharmacyTrustRegistry);
        pharmacyTrustRegistry = IPharmacyTrust(_pharmacyTrustRegistry);
        emit PharmacyTrustUpdated(old, _pharmacyTrustRegistry);
    }

    function setRiskThreshold(uint256 _maxRiskScore) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 old = maxAllowedRiskScore;
        maxAllowedRiskScore = _maxRiskScore;
        emit RiskThresholdUpdated(old, _maxRiskScore);
    }

    function setTrustThreshold(uint256 _minTrustScore) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 old = minRequiredTrustScore;
        minRequiredTrustScore = _minTrustScore;
        emit TrustThresholdUpdated(old, _minTrustScore);
    }
}
