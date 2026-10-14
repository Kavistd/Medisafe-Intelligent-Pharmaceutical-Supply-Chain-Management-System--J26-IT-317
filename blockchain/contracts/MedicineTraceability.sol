// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

/// @notice Whole-batch custody with recipient-confirmed, ordered transfers.
contract MedicineTraceability is AccessControl {
    bytes32 public constant MANUFACTURER_ROLE = keccak256("MANUFACTURER_ROLE");
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");
    bytes32 public constant PHARMACY_ROLE = keccak256("PHARMACY_ROLE");
    bytes32 public constant RECALL_ROLE = keccak256("RECALL_ROLE");

    enum Stage { Manufacturer, Distributor, Pharmacy }

    struct BatchData {
        string batchId;
        string medicineId;
        string name;
        string category;
        string dosageForm;
        string strength;
        string manufacturerName;
        string indication;
        string classification;
        uint256 quantity;
        uint256 manufacturedAt;
        uint256 expiresAt;
        string documentReference;
        string certificateReference;
    }

    struct Batch {
        BatchData data;
        address manufacturer;
        address owner;
        Stage stage;
        bool recalled;
    }

    struct PendingTransfer {
        uint256 id;
        address from;
        address to;
        Stage nextStage;
        uint256 initiatedAt;
    }

    struct CompletedTransfer {
        uint256 id;
        address from;
        address to;
        Stage stage;
        uint256 initiatedAt;
        uint256 confirmedAt;
    }

    mapping(string => Batch) private _batches;
    mapping(string => PendingTransfer) private _pending;
    mapping(string => CompletedTransfer[]) private _history;
    mapping(string => uint256) private _transferSequence;

    error InvalidAdmin();
    error InvalidField(string field);
    error BatchAlreadyExists(string batchId);
    error BatchNotFound(string batchId);
    error NotCurrentOwner();
    error InvalidRecipient();
    error InvalidParticipantRole();
    error FinalStage();
    error TransferAlreadyPending();
    error NoPendingTransfer();
    error StaleTransfer();
    error NotRecipient();
    error NotTransferParticipant();
    error BatchRecalled();
    error BatchExpired();
    error HistoryIndexOutOfBounds();

    // The unindexed string preserves the readable ID; clients can filter by its hash.
    event BatchRegistered(bytes32 indexed batchKey, string batchId, address indexed manufacturer);
    event TransferInitiated(bytes32 indexed batchKey, string batchId, uint256 transferId, address indexed from, address indexed to, Stage nextStage);
    event TransferConfirmed(bytes32 indexed batchKey, string batchId, uint256 transferId, address indexed from, address indexed to, Stage stage);
    event TransferCancelled(bytes32 indexed batchKey, string batchId, uint256 transferId, address indexed actor);
    event BatchRecallRecorded(bytes32 indexed batchKey, string batchId, address indexed actor, string reason);

    constructor(address admin) {
        if (admin == address(0)) revert InvalidAdmin();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function registerBatch(BatchData calldata data) external onlyRole(MANUFACTURER_ROLE) {
        _required(data.batchId, "batchId");
        if (_batches[data.batchId].owner != address(0)) revert BatchAlreadyExists(data.batchId);
        _required(data.medicineId, "medicineId");
        _required(data.name, "name");
        _required(data.category, "category");
        _required(data.dosageForm, "dosageForm");
        _required(data.strength, "strength");
        _required(data.manufacturerName, "manufacturerName");
        _required(data.indication, "indication");
        _required(data.classification, "classification");
        _required(data.documentReference, "documentReference");
        _required(data.certificateReference, "certificateReference");
        if (data.quantity == 0) revert InvalidField("quantity");
        if (data.manufacturedAt == 0 || data.manufacturedAt > block.timestamp) revert InvalidField("manufacturedAt");
        if (data.expiresAt <= data.manufacturedAt || data.expiresAt <= block.timestamp) revert InvalidField("expiresAt");

        Batch storage batch = _batches[data.batchId];
        batch.data = data;
        batch.manufacturer = msg.sender;
        batch.owner = msg.sender;
        emit BatchRegistered(keccak256(bytes(data.batchId)), data.batchId, msg.sender);
    }

    function initiateTransfer(string calldata batchId, address recipient) external {
        Batch storage batch = _getBatch(batchId);
        if (msg.sender != batch.owner) revert NotCurrentOwner();
        _requireActive(batch);
        if (batch.stage == Stage.Pharmacy) revert FinalStage();
        if (_pending[batchId].id != 0) revert TransferAlreadyPending();
        if (recipient == address(0) || recipient == msg.sender) revert InvalidRecipient();
        Stage nextStage = Stage(uint256(batch.stage) + 1);
        if (!hasRole(_role(batch.stage), msg.sender) || !hasRole(_role(nextStage), recipient)) revert InvalidParticipantRole();

        uint256 id = ++_transferSequence[batchId];
        _pending[batchId] = PendingTransfer(id, msg.sender, recipient, nextStage, block.timestamp);
        emit TransferInitiated(keccak256(bytes(batchId)), batchId, id, msg.sender, recipient, nextStage);
    }

    function confirmTransfer(string calldata batchId, uint256 transferId) external {
        Batch storage batch = _getBatch(batchId);
        PendingTransfer memory pending = _getPending(batchId, transferId);
        if (msg.sender != pending.to) revert NotRecipient();
        _requireActive(batch);
        if (batch.owner != pending.from) revert NotCurrentOwner();
        if (!hasRole(_role(batch.stage), pending.from) || !hasRole(_role(pending.nextStage), pending.to)) revert InvalidParticipantRole();

        batch.owner = pending.to;
        batch.stage = pending.nextStage;
        _history[batchId].push(CompletedTransfer(pending.id, pending.from, pending.to, pending.nextStage, pending.initiatedAt, block.timestamp));
        delete _pending[batchId];
        emit TransferConfirmed(keccak256(bytes(batchId)), batchId, pending.id, pending.from, pending.to, pending.nextStage);
    }

    /// @notice Sender cancellation or recipient rejection; also usable after recall/expiry.
    function cancelTransfer(string calldata batchId, uint256 transferId) external {
        _getBatch(batchId);
        PendingTransfer memory pending = _getPending(batchId, transferId);
        if (msg.sender != pending.from && msg.sender != pending.to) revert NotTransferParticipant();
        delete _pending[batchId];
        emit TransferCancelled(keccak256(bytes(batchId)), batchId, transferId, msg.sender);
    }

    function recallBatch(string calldata batchId, string calldata reason) external onlyRole(RECALL_ROLE) {
        Batch storage batch = _getBatch(batchId);
        if (batch.recalled) revert BatchRecalled();
        _required(reason, "reason");
        batch.recalled = true;
        emit BatchRecallRecorded(keccak256(bytes(batchId)), batchId, msg.sender, reason);
    }

    function getBatch(string calldata batchId) external view returns (Batch memory) {
        return _getBatch(batchId);
    }

    function getPendingTransfer(string calldata batchId) external view returns (PendingTransfer memory) {
        _getBatch(batchId);
        return _pending[batchId];
    }

    function isBatchExpired(string calldata batchId) external view returns (bool) {
        return block.timestamp >= _getBatch(batchId).data.expiresAt;
    }

    function getTransferHistoryCount(string calldata batchId) external view returns (uint256) {
        _getBatch(batchId);
        return _history[batchId].length;
    }

    function getTransferHistory(string calldata batchId) external view returns (CompletedTransfer[] memory) {
        _getBatch(batchId);
        return _history[batchId]; // Bounded to two completed transfers by the state machine.
    }

    function getTransferHistoryEntry(string calldata batchId, uint256 index) external view returns (CompletedTransfer memory) {
        _getBatch(batchId);
        if (index >= _history[batchId].length) revert HistoryIndexOutOfBounds();
        return _history[batchId][index];
    }

    function _getBatch(string memory batchId) private view returns (Batch storage batch) {
        batch = _batches[batchId];
        if (batch.owner == address(0)) revert BatchNotFound(batchId);
    }

    function _getPending(string memory batchId, uint256 id) private view returns (PendingTransfer memory pending) {
        pending = _pending[batchId];
        if (pending.id == 0) revert NoPendingTransfer();
        if (pending.id != id) revert StaleTransfer();
    }

    function _requireActive(Batch storage batch) private view {
        if (batch.recalled) revert BatchRecalled();
        if (block.timestamp >= batch.data.expiresAt) revert BatchExpired();
    }

    function _role(Stage stage) private pure returns (bytes32) {
        if (stage == Stage.Manufacturer) return MANUFACTURER_ROLE;
        if (stage == Stage.Distributor) return DISTRIBUTOR_ROLE;
        return PHARMACY_ROLE;
    }

    function _required(string memory value, string memory field) private pure {
        bytes memory chars = bytes(value);
        for (uint256 i; i < chars.length; ++i) {
            if (uint8(chars[i]) > 32) return;
        }
        revert InvalidField(field);
    }
}
