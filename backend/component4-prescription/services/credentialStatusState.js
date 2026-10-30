const ACTIVE = "ACTIVE";
const REVOKED = "REVOKED";

function validateState(state) {
  if (
    !state ||
    (state.status !== ACTIVE && state.status !== REVOKED) ||
    !Number.isSafeInteger(state.version) ||
    state.version < 1
  ) {
    throw new TypeError("Credential status state is invalid.");
  }
}

/** Creates the architecture-neutral status/version state for a newly issued credential. */
function createCredentialStatusState() {
  return Object.freeze({ status: ACTIVE, version: 1 });
}

/** Returns whether a credential version matches the current active status state. */
function isCredentialVersionCurrent(credentialVersion, currentState) {
  validateState(currentState);
  return Number.isSafeInteger(credentialVersion) &&
    credentialVersion === currentState.version &&
    currentState.status === ACTIVE;
}

/** Independently revokes an active status state by advancing its version monotonically. */
function revokeCredentialStatusState(currentState) {
  validateState(currentState);
  if (currentState.status !== ACTIVE) {
    throw new Error("Only an active credential status can be revoked.");
  }
  if (currentState.version === Number.MAX_SAFE_INTEGER) {
    throw new RangeError("Credential status version cannot be advanced safely.");
  }
  return Object.freeze({ status: REVOKED, version: currentState.version + 1 });
}

module.exports = {
  ACTIVE,
  REVOKED,
  createCredentialStatusState,
  isCredentialVersionCurrent,
  revokeCredentialStatusState,
};
