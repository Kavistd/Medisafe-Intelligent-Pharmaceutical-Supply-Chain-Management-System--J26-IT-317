const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ACTIVE,
  REVOKED,
  createCredentialStatusState,
  isCredentialVersionCurrent,
  revokeCredentialStatusState,
} = require("../services/credentialStatusState");

test("new credential lifecycle state starts active at version 1 without an identifier", () => {
  const state = createCredentialStatusState();

  assert.deepEqual(state, { status: ACTIVE, version: 1 });
  assert.equal(Object.hasOwn(state, "credentialId"), false);
  assert.equal(isCredentialVersionCurrent(1, state), true);
  assert.equal(isCredentialVersionCurrent(2, state), false);
});

test("independent revocation advances the version and invalidates the issued version", () => {
  const issuedState = createCredentialStatusState();
  const revokedState = revokeCredentialStatusState(issuedState);

  assert.deepEqual(issuedState, { status: ACTIVE, version: 1 });
  assert.deepEqual(revokedState, { status: REVOKED, version: 2 });
  assert.equal(isCredentialVersionCurrent(1, revokedState), false);
  assert.equal(isCredentialVersionCurrent(2, revokedState), false);
});

test("revocation is terminal and malformed status states fail closed", () => {
  const revokedState = revokeCredentialStatusState(createCredentialStatusState());

  assert.throws(() => revokeCredentialStatusState(revokedState), /Only an active/);
  assert.throws(() => isCredentialVersionCurrent(1, { status: ACTIVE, version: 0 }), /invalid/);
  assert.throws(() => isCredentialVersionCurrent(1, { status: "UNKNOWN", version: 1 }), /invalid/);
});
