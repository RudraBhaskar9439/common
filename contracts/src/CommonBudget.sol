// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title CommonBudget
 * @notice Workspace budget authority and atomic reservation ledger for Common.
 *
 * WHAT THIS CONTRACT IS
 * ---------------------
 * It is the authoritative, atomic ledger for budget accounting and duplicate
 * prevention, and the event source indexed by the subgraph. Two agents racing for
 * the same purchaseKey produce exactly one reservation because `reserve` claims the
 * key in a single indivisible state transition.
 *
 * WHAT THIS CONTRACT IS NOT
 * -------------------------
 * It does NOT hold or custody funds, and it CANNOT enforce that a payment happened.
 * The x402 `exact` scheme on Hedera settles as a direct TransferTransaction; the spec
 * forbids wrapping it or invoking a contract in the payment path. No contract can sit
 * between a signer and the funds on that path.
 *
 * Enforcement therefore lives off-chain, in the operator service that holds the sole
 * treasury key: agents hold no key and cannot construct or sign a transfer, and the
 * operator signs only against an active reservation whose bound parameters match the
 * transfer exactly. That is trusted custody, and it is stated plainly rather than
 * dressed up as on-chain enforcement.
 *
 * Consequently `fundWorkspace` records an accounting allocation. It does not move value.
 */
contract CommonBudget {
    // ---------------------------------------------------------------- types

    enum Status {
        None,
        Reserved,
        PaymentPending,
        SettlementUnknown,
        Paid,
        Delivered,
        DeliveryFailed,
        Released,
        Expired
    }

    /// @dev Reason codes for ReservationReleased.
    uint8 internal constant RELEASE_EXPLICIT = 0;
    uint8 internal constant RELEASE_EXPIRED = 1;
    uint8 internal constant RELEASE_RECONCILED_ABSENT = 2;

    struct Workspace {
        bool exists;
        address operator;
        uint64 policyVersion;
        uint256 budget;
        uint256 committed; // reserved but not yet settled
        uint256 spent; // settled
    }

    struct Operation {
        bytes32 workspaceId;
        bytes32 purchaseKey;
        bytes32 agentId;
        uint256 amount;
        uint64 expiresAt;
        uint64 policyVersion;
        Status status;
        /// @dev Binds the operation to its resource, asset, payTo and amount.
        bytes32 paramsHash;
    }

    // ---------------------------------------------------------------- state

    mapping(bytes32 => Workspace) private _workspaces;
    mapping(bytes32 => Operation) private _operations;

    /// @dev workspaceId => agentId => authorized
    mapping(bytes32 => mapping(bytes32 => bool)) private _authorized;

    /// @dev workspaceId => purchaseKey => operationId currently holding the claim.
    mapping(bytes32 => mapping(bytes32 => bytes32)) private _activeClaim;

    // --------------------------------------------------------------- events

    event WorkspaceCreated(bytes32 indexed workspaceId, address operator);
    event WorkspaceFunded(bytes32 indexed workspaceId, uint256 amount, uint256 budget, uint64 policyVersion);
    event AgentAuthorized(bytes32 indexed workspaceId, bytes32 indexed agentId, bool authorized, uint64 policyVersion);

    event PurchaseReserved(
        bytes32 indexed workspaceId,
        bytes32 indexed operationId,
        bytes32 indexed purchaseKey,
        bytes32 agentId,
        uint256 amount,
        string asset,
        string payTo,
        string resource,
        uint64 expiresAt,
        uint64 policyVersion
    );

    event PaymentPending(bytes32 indexed operationId);
    event SettlementUnknownFlagged(bytes32 indexed operationId);
    event PaymentSettled(bytes32 indexed operationId, string transactionId, uint256 amount, uint64 settledAt);

    event DeliveryRecorded(
        bytes32 indexed operationId, bool usable, uint64 freshUntil, string resultRef, string failureReason
    );

    event ReservationReleased(bytes32 indexed operationId, uint8 reason);

    event DecisionRecorded(
        bytes32 indexed workspaceId,
        bytes32 indexed decisionId,
        bytes32 agentId,
        uint8 decisionType, // 0 buy, 1 reuse, 2 wait, 3 reject
        bytes32 operationId,
        string hcsSequenceNumber
    );

    // --------------------------------------------------------------- errors

    error WorkspaceExists();
    error UnknownWorkspace();
    error NotOperator();
    error AgentNotAuthorized();
    error InsufficientBudget(uint256 available, uint256 requested);
    error PurchaseAlreadyReserved(bytes32 operationId);
    error UnknownOperation();
    error ConflictingParameters();
    error InvalidState(Status current);
    error ReservationNotExpired();
    error ReservationExpired();
    error SettlementUnknownBlocksRelease();

    // ------------------------------------------------------------ modifiers

    modifier onlyOperator(bytes32 workspaceId) {
        Workspace storage w = _workspaces[workspaceId];
        if (!w.exists) revert UnknownWorkspace();
        if (msg.sender != w.operator) revert NotOperator();
        _;
    }

    // ------------------------------------------------------- administration

    function createWorkspace(bytes32 workspaceId, address operator) external {
        if (_workspaces[workspaceId].exists) revert WorkspaceExists();
        _workspaces[workspaceId] =
            Workspace({exists: true, operator: operator, policyVersion: 1, budget: 0, committed: 0, spent: 0});
        emit WorkspaceCreated(workspaceId, operator);
    }

    /**
     * @notice Records a budget allocation. Does NOT transfer value; this contract
     *         never custodies funds. See the contract-level notice.
     */
    function fundWorkspace(bytes32 workspaceId, uint256 amount) external onlyOperator(workspaceId) {
        Workspace storage w = _workspaces[workspaceId];
        w.budget += amount;
        w.policyVersion += 1;
        emit WorkspaceFunded(workspaceId, amount, w.budget, w.policyVersion);
    }

    function setAgentAuthorization(bytes32 workspaceId, bytes32 agentId, bool authorized)
        external
        onlyOperator(workspaceId)
    {
        Workspace storage w = _workspaces[workspaceId];
        _authorized[workspaceId][agentId] = authorized;
        w.policyVersion += 1;
        emit AgentAuthorized(workspaceId, agentId, authorized, w.policyVersion);
    }

    // ------------------------------------------------------------- reserve

    /**
     * @notice Atomically claims a purchaseKey for one operation, if the agent is
     *         authorized and uncommitted budget covers the amount.
     * @dev Re-presenting the same operationId with identical parameters is a no-op
     *      returning the existing reservation, which is what makes retries after a
     *      crash safe. Conflicting parameters revert.
     * @param paramsHash Binds resource, asset, payTo and amount. The operator must
     *        recompute this from the actual transfer before signing, and refuse to
     *        sign on any mismatch.
     */
    function reserve(
        bytes32 operationId,
        bytes32 workspaceId,
        bytes32 agentId,
        bytes32 purchaseKey,
        uint256 amount,
        string calldata asset,
        string calldata payTo,
        string calldata resource,
        uint64 ttlSeconds,
        bytes32 paramsHash
    ) external onlyOperator(workspaceId) {
        Workspace storage w = _workspaces[workspaceId];
        Operation storage existing = _operations[operationId];

        // Idempotent retry: same id, same parameters, still live.
        if (existing.status != Status.None) {
            if (
                existing.workspaceId != workspaceId || existing.purchaseKey != purchaseKey
                    || existing.amount != amount || existing.paramsHash != paramsHash || existing.agentId != agentId
            ) revert ConflictingParameters();
            if (existing.status != Status.Reserved) revert InvalidState(existing.status);
            return;
        }

        if (!_authorized[workspaceId][agentId]) revert AgentNotAuthorized();

        // The active claim is released lazily if it has lapsed while still Reserved.
        bytes32 claim = _activeClaim[workspaceId][purchaseKey];
        if (claim != bytes32(0)) {
            Operation storage held = _operations[claim];
            bool lapsed = held.status == Status.Reserved && block.timestamp > held.expiresAt;
            if (lapsed) {
                held.status = Status.Expired;
                w.committed -= held.amount;
                emit ReservationReleased(claim, RELEASE_EXPIRED);
            } else if (_holdsClaim(held.status)) {
                revert PurchaseAlreadyReserved(claim);
            }
        }

        uint256 available = w.budget - w.committed - w.spent;
        if (available < amount) revert InsufficientBudget(available, amount);

        uint64 expiresAt = uint64(block.timestamp) + ttlSeconds;
        _operations[operationId] = Operation({
            workspaceId: workspaceId,
            purchaseKey: purchaseKey,
            agentId: agentId,
            amount: amount,
            expiresAt: expiresAt,
            policyVersion: w.policyVersion,
            status: Status.Reserved,
            paramsHash: paramsHash
        });
        _activeClaim[workspaceId][purchaseKey] = operationId;
        w.committed += amount;

        emit PurchaseReserved(
            workspaceId, operationId, purchaseKey, agentId, amount, asset, payTo, resource, expiresAt, w.policyVersion
        );
    }

    /// @dev Statuses that keep a purchaseKey claimed against new reservations.
    function _holdsClaim(Status s) private pure returns (bool) {
        return s == Status.Reserved || s == Status.PaymentPending || s == Status.SettlementUnknown || s == Status.Paid
            || s == Status.Delivered || s == Status.DeliveryFailed;
    }

    // ------------------------------------------------------------ lifecycle

    function markPaymentPending(bytes32 operationId) external {
        Operation storage op = _requireOperator(operationId);
        if (op.status != Status.Reserved) revert InvalidState(op.status);
        if (block.timestamp > op.expiresAt) revert ReservationExpired();
        op.status = Status.PaymentPending;
        emit PaymentPending(operationId);
    }

    function flagSettlementUnknown(bytes32 operationId) external {
        Operation storage op = _requireOperator(operationId);
        if (op.status != Status.PaymentPending) revert InvalidState(op.status);
        op.status = Status.SettlementUnknown;
        emit SettlementUnknownFlagged(operationId);
    }

    /// @notice Records a settled payment. Reachable from PaymentPending or, after
    ///         reconciliation against the mirror node, from SettlementUnknown.
    function recordSettlement(bytes32 operationId, string calldata transactionId, uint256 amount) external {
        Operation storage op = _requireOperator(operationId);
        if (op.status != Status.PaymentPending && op.status != Status.SettlementUnknown) revert InvalidState(op.status);
        if (amount != op.amount) revert ConflictingParameters();

        Workspace storage w = _workspaces[op.workspaceId];
        w.committed -= op.amount;
        w.spent += op.amount;
        op.status = Status.Paid;
        emit PaymentSettled(operationId, transactionId, amount, uint64(block.timestamp));
    }

    /**
     * @notice Records delivery success or failure against a settled payment.
     * @dev Payment and delivery are separate outcomes. A failure here does not refund,
     *      does not release the claim, and never authorizes an automatic repurchase.
     */
    function recordDelivery(
        bytes32 operationId,
        bool usable,
        uint64 freshUntil,
        string calldata resultRef,
        string calldata failureReason
    ) external {
        Operation storage op = _requireOperator(operationId);
        if (op.status != Status.Paid) revert InvalidState(op.status);
        op.status = usable ? Status.Delivered : Status.DeliveryFailed;
        emit DeliveryRecorded(operationId, usable, freshUntil, resultRef, failureReason);
    }

    /**
     * @notice Releases an unpaid reservation and returns its committed budget.
     * @dev Permitted only where we have positive evidence no transfer was submitted.
     *      SettlementUnknown is explicitly refused: a stuck operation stays visibly
     *      stuck until reconciliation resolves it, so uncertainty can never become a
     *      second payment.
     */
    function release(bytes32 operationId) external {
        Operation storage op = _requireOperator(operationId);
        if (op.status == Status.SettlementUnknown) revert SettlementUnknownBlocksRelease();
        if (op.status != Status.Reserved) revert InvalidState(op.status);
        _unwind(op, operationId, RELEASE_EXPLICIT);
    }

    /// @notice Expires a lapsed, still-unpaid reservation. Callable by anyone.
    function expire(bytes32 operationId) external {
        Operation storage op = _operations[operationId];
        if (op.status == Status.None) revert UnknownOperation();
        if (op.status != Status.Reserved) revert InvalidState(op.status);
        if (block.timestamp <= op.expiresAt) revert ReservationNotExpired();
        _unwind(op, operationId, RELEASE_EXPIRED);
    }

    /// @notice Releases budget after reconciliation proved no transfer exists.
    function releaseAfterReconciliation(bytes32 operationId) external {
        Operation storage op = _requireOperator(operationId);
        if (op.status != Status.SettlementUnknown) revert InvalidState(op.status);
        _unwind(op, operationId, RELEASE_RECONCILED_ABSENT);
    }

    function _unwind(Operation storage op, bytes32 operationId, uint8 reason) private {
        Workspace storage w = _workspaces[op.workspaceId];
        w.committed -= op.amount;
        op.status = reason == RELEASE_EXPIRED ? Status.Expired : Status.Released;
        if (_activeClaim[op.workspaceId][op.purchaseKey] == operationId) {
            delete _activeClaim[op.workspaceId][op.purchaseKey];
        }
        emit ReservationReleased(operationId, reason);
    }

    // ------------------------------------------------------------ decisions

    /**
     * @notice Records a buy/reuse/wait/reject decision for the audit trail.
     * @dev Reuse and wait decisions create no payment and move no budget.
     */
    function recordDecision(
        bytes32 workspaceId,
        bytes32 decisionId,
        bytes32 agentId,
        uint8 decisionType,
        bytes32 operationId,
        string calldata hcsSequenceNumber
    ) external onlyOperator(workspaceId) {
        emit DecisionRecorded(workspaceId, decisionId, agentId, decisionType, operationId, hcsSequenceNumber);
    }

    // --------------------------------------------------------------- views

    function getOperation(bytes32 operationId) external view returns (Operation memory) {
        Operation memory op = _operations[operationId];
        if (op.status == Status.None) revert UnknownOperation();
        return op;
    }

    function getWorkspace(bytes32 workspaceId) external view returns (Workspace memory) {
        Workspace memory w = _workspaces[workspaceId];
        if (!w.exists) revert UnknownWorkspace();
        return w;
    }

    function availableBudget(bytes32 workspaceId) external view returns (uint256) {
        Workspace memory w = _workspaces[workspaceId];
        if (!w.exists) revert UnknownWorkspace();
        return w.budget - w.committed - w.spent;
    }

    function isAgentAuthorized(bytes32 workspaceId, bytes32 agentId) external view returns (bool) {
        return _authorized[workspaceId][agentId];
    }

    function activeClaim(bytes32 workspaceId, bytes32 purchaseKey) external view returns (bytes32) {
        return _activeClaim[workspaceId][purchaseKey];
    }

    function _requireOperator(bytes32 operationId) private view returns (Operation storage op) {
        op = _operations[operationId];
        if (op.status == Status.None) revert UnknownOperation();
        Workspace storage w = _workspaces[op.workspaceId];
        if (msg.sender != w.operator) revert NotOperator();
    }
}
