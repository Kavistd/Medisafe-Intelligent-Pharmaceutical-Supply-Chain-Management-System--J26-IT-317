const assert = require("node:assert/strict");
const test = require("node:test");
const { ethers } = require("ethers");
const http = require("node:http");

const servicePath = require.resolve("../services/prescriptionService");

async function call(app, method, route, { token, body, rawBody } = {}) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(rawBody !== undefined ? { body: rawBody } : body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  } finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

function loadApp(serviceOverrides = {}) {
  const original = require.cache[servicePath];
  const roleProvider = {
    getNetwork: async () => ({ chainId: 31337n }),
    getCode: async () => "0x6001",
  };
  require.cache[servicePath] = {
    id: servicePath,
    filename: servicePath,
    loaded: true,
    exports: {
      getProvider: () => roleProvider,
      getConfiguredSignerAddress: () => process.env.TEST_DOCTOR || "0x0000000000000000000000000000000000000001",
      getPrescriptionIssuer: async () => process.env.TEST_DOCTOR || "0x0000000000000000000000000000000000000001",
      getContract: () => ({
        getAddress: async () => "0x0000000000000000000000000000000000000003",
        DOCTOR_ROLE: async () => "doctor-role",
        PHARMACY_ROLE: async () => "pharmacy-role",
      hasRole: async (role, address) => (role === "doctor-role" && address.toLowerCase() ===
          (process.env.TEST_DOCTOR || "0x0000000000000000000000000000000000000001").toLowerCase()) ||
          (role === "pharmacy-role" && address.toLowerCase() === (process.env.TEST_PHARMACY || "0x0000000000000000000000000000000000000002").toLowerCase()),
      }),
      ...serviceOverrides,
    },
  };
  delete require.cache[require.resolve("../middleware/auth")];
  delete require.cache[require.resolve("../routes/prescriptionRoutes")];
  delete require.cache[require.resolve("../controllers/prescriptionController")];
  delete require.cache[require.resolve("../server")];
  process.env.AUTH_TOKEN_SECRET = "local-component4-test-secret-at-least-32-characters";
  const app = require("../server");
  return { app, restore: () => { if (original) require.cache[servicePath] = original; else delete require.cache[servicePath]; } };
}

async function login(app, wallet, patient = false, prescriptionId) {
  const challengeResponse = await call(app, "POST", "/api/v1/prescriptions/auth/challenge", { body: { address: wallet.address, patient, prescriptionId: patient ? prescriptionId : undefined } });
  assert.equal(challengeResponse.status, 200);
  const { message } = challengeResponse.body.data;
  const tokenResponse = await call(app, "POST", "/api/v1/prescriptions/auth/token", { body: { message, signature: await wallet.signMessage(message) } });
  assert.equal(tokenResponse.status, 200);
  return tokenResponse.body.data.token;
}

function assertMarkersAbsent(responseBody, markers) {
  const serialized = JSON.stringify(responseBody);
  for (const marker of markers) assert.equal(serialized.includes(marker), false, `response leaked marker: ${marker}`);
}

test("issue route requires doctor authorization and never submits through the backend", async () => {
  const doctor = new ethers.Wallet("0x" + "11".repeat(32));
  process.env.TEST_DOCTOR = doctor.address;
  let backendWriteCalled = false;
  const { app, restore } = loadApp({ issuePrescription: async () => { backendWriteCalled = true; } });
  try {
    const response = await call(app, "POST", "/api/v1/prescriptions/issue", { body: { patientHash: "0x" + "a".repeat(64), medicineId: "MED-1", batchId: "BAT-1" } });
    assert.equal(response.status, 401);
    const token = await login(app, doctor);
    const issued = await call(app, "POST", "/api/v1/prescriptions/issue", { token, body: { patientHash: "0x" + "a".repeat(64), medicineId: "MED-1", batchId: "BAT-1" } });
    assert.equal(issued.status, 410);
    assert.equal(issued.body.error, "WALLET_TRANSACTION_REQUIRED");
    assert.equal(backendWriteCalled, false);
  } finally { restore(); delete process.env.TEST_DOCTOR; }
});

test("issue, dispense, and revoke routes validate authenticated payloads before wallet-only response", async () => {
  const doctor = new ethers.Wallet("0x" + "12".repeat(32));
  const pharmacy = new ethers.Wallet("0x" + "13".repeat(32));
  process.env.TEST_DOCTOR = doctor.address;
  process.env.TEST_PHARMACY = pharmacy.address;
  let backendWriteCalled = false;
  const { app, restore } = loadApp({
    issuePrescription: async () => { backendWriteCalled = true; },
    dispensePrescription: async () => { backendWriteCalled = true; },
    revokePrescription: async () => { backendWriteCalled = true; },
  });
  try {
    const doctorToken = await login(app, doctor);
    const pharmacyToken = await login(app, pharmacy);
    const invalidIssue = await call(app, "POST", "/api/v1/prescriptions/issue", {
      token: doctorToken,
      body: { patientHash: "invalid", medicineId: "", batchId: "bad id" },
    });
    assert.equal(invalidIssue.status, 400);
    assert.equal(invalidIssue.body.error, "VALIDATION_ERROR");

    const validIssue = await call(app, "POST", "/api/v1/prescriptions/issue", {
      token: doctorToken,
      body: { patientHash: `0x${"a".repeat(64)}`, medicineId: "MED-1", batchId: "BATCH-1" },
    });
    assert.equal(validIssue.status, 410);
    assert.equal(validIssue.body.error, "WALLET_TRANSACTION_REQUIRED");

    const invalidDispense = await call(app, "POST", "/api/v1/prescriptions/dispense", {
      token: pharmacyToken,
      body: { prescriptionId: "not-bytes32", patientHash: "invalid" },
    });
    assert.equal(invalidDispense.status, 400);
    assert.equal(invalidDispense.body.error, "VALIDATION_ERROR");

    const invalidRevoke = await call(app, "POST", "/api/v1/prescriptions/revoke", {
      token: doctorToken,
      body: { prescriptionId: `0x${"b".repeat(64)}`, reason: "   " },
    });
    assert.equal(invalidRevoke.status, 400);
    assert.equal(invalidRevoke.body.error, "VALIDATION_ERROR");

    const validRevoke = await call(app, "POST", "/api/v1/prescriptions/revoke", {
      token: doctorToken,
      body: { prescriptionId: `0x${"b".repeat(64)}`, reason: "Duplicate entry" },
    });
    assert.equal(validRevoke.status, 410);
    assert.equal(validRevoke.body.error, "WALLET_TRANSACTION_REQUIRED");
    assert.equal(backendWriteCalled, false);
  } finally {
    restore();
    delete process.env.TEST_DOCTOR;
    delete process.env.TEST_PHARMACY;
  }
});

test("challenge signed from the frontend personal_sign hex payload verifies against the exact UTF-8 message", async () => {
  const doctor = new ethers.Wallet("0x" + "18".repeat(32));
  process.env.TEST_DOCTOR = doctor.address;
  const { app, restore } = loadApp();
  try {
    const challenge = (await call(app, "POST", "/api/v1/prescriptions/auth/challenge", { body: { address: doctor.address } })).body.data;
    const signableBytes = ethers.getBytes(ethers.hexlify(ethers.toUtf8Bytes(challenge.message)));
    const signature = await doctor.signMessage(signableBytes);
    const response = await call(app, "POST", "/api/v1/prescriptions/auth/token", { body: { message: challenge.message, signature } });
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
  } finally { restore(); delete process.env.TEST_DOCTOR; }
});

test("role lookup BAD_DATA is reported as blockchain configuration failure, not invalid signature", async () => {
  const doctor = new ethers.Wallet("0x" + "19".repeat(32));
  process.env.TEST_DOCTOR = doctor.address;
  const badData = Object.assign(new Error("role getter returned malformed ABI data"), { code: "BAD_DATA" });
  const { app, restore } = loadApp({ getContract: () => ({ DOCTOR_ROLE: async () => { throw badData; } }) });
  try {
    const challenge = (await call(app, "POST", "/api/v1/prescriptions/auth/challenge", { body: { address: doctor.address } })).body.data;
    const signature = await doctor.signMessage(challenge.message);
    const response = await call(app, "POST", "/api/v1/prescriptions/auth/token", { body: { message: challenge.message, signature } });
    assert.equal(response.status, 503);
    assert.equal(response.body.error, "AUTH_CONFIGURATION_ERROR");
    assert.doesNotMatch(response.body.message, /signature/i);
  } finally { restore(); delete process.env.TEST_DOCTOR; }
});

test("role login explains when the configured V1 address has no deployed bytecode", async () => {
  const doctor = new ethers.Wallet("0x" + "1a".repeat(32));
  const { app, restore } = loadApp({ getProvider: () => ({
    getNetwork: async () => ({ chainId: 31337n }),
    getCode: async () => "0x",
  }), getContract: () => ({
    getAddress: async () => "0x0000000000000000000000000000000000000003",
    DOCTOR_ROLE: async () => { throw new Error("must not call role getter without deployed code"); },
    PHARMACY_ROLE: async () => "pharmacy-role",
    hasRole: async () => false,
  }) });
  try {
    const challenge = (await call(app, "POST", "/api/v1/prescriptions/auth/challenge", { body: { address: doctor.address } })).body.data;
    const response = await call(app, "POST", "/api/v1/prescriptions/auth/token", { body: { message: challenge.message, signature: await doctor.signMessage(challenge.message) } });
    assert.equal(response.status, 503);
    assert.equal(response.body.error, "AUTH_CONFIGURATION_ERROR");
    assert.match(response.body.message, /No Component 4 PrescriptionRegistry is deployed.*node may have restarted/i);
  } finally { restore(); }
});

test("professional role login rejects an RPC on a non-local chain before reading roles", async () => {
  const doctor = new ethers.Wallet("0x" + "1b".repeat(32));
  let roleRead = false;
  const { app, restore } = loadApp({
    getProvider: () => ({ getNetwork: async () => ({ chainId: 1n }), getCode: async () => { throw new Error("must not read code"); } }),
    getContract: () => ({
      getAddress: async () => "0x0000000000000000000000000000000000000003",
      DOCTOR_ROLE: async () => { roleRead = true; return "doctor-role"; },
    }),
  });
  try {
    const challenge = (await call(app, "POST", "/api/v1/prescriptions/auth/challenge", { body: { address: doctor.address } })).body.data;
    const response = await call(app, "POST", "/api/v1/prescriptions/auth/token", { body: { message: challenge.message, signature: await doctor.signMessage(challenge.message) } });
    assert.equal(response.status, 503);
    assert.equal(response.body.error, "AUTH_CONFIGURATION_ERROR");
    assert.match(response.body.message, /wrong blockchain network/i);
    assert.equal(roleRead, false);
  } finally { restore(); }
});

test("professional role authorization rechecks that the RPC remains on chain 31337", async () => {
  const doctor = new ethers.Wallet("0x" + "1c".repeat(32));
  process.env.TEST_DOCTOR = doctor.address;
  let chainId = 31337n;
  const { app, restore } = loadApp({
    getProvider: () => ({ getNetwork: async () => ({ chainId }), getCode: async () => "0x6001" }),
  });
  try {
    const token = await login(app, doctor);
    chainId = 1n;
    const response = await call(app, "GET", "/api/v1/prescriptions/mine", { token });
    assert.equal(response.status, 503);
    assert.equal(response.body.error, "AUTH_CONFIGURATION_ERROR");
    assert.match(response.body.message, /wrong blockchain network/i);
  } finally { restore(); }
});

test("patient hash verification and revoke routes enforce authorization and return controlled responses", async () => {
  const doctor = new ethers.Wallet("0x" + "22".repeat(32));
  const patient = new ethers.Wallet("0x" + "33".repeat(32));
  process.env.TEST_DOCTOR = doctor.address;
  let backendRevokeCalled = false;
  const { app, restore } = loadApp({
    verifyPrescription: async () => ({ success: true, data: { prescriptionId: "0xabc", patientHashVerified: true, identityVerification: "not-performed", status: "ACTIVE" } }),
    revokePrescription: async () => { backendRevokeCalled = true; },
    getPrescriptionIssuer: async () => doctor.address,
  });
  try {
    const prescriptionId = `0x${"a".repeat(64)}`;
    const unauthorizedVerify = await call(app, "POST", "/api/v1/prescriptions/verify", { body: { prescriptionId, patientHash: `0x${"b".repeat(64)}` } });
    assert.equal(unauthorizedVerify.status, 401);
    const patientToken = await login(app, patient, true, prescriptionId);
    const patientHash = `0x${"b".repeat(64)}`;
    const verified = await call(app, "POST", "/api/v1/prescriptions/verify", { token: patientToken, body: { prescriptionId, patientHash } });
    assert.equal(verified.status, 200);
    assertMarkersAbsent(verified.body, [patientHash]);
    const outOfScope = await call(app, "POST", "/api/v1/prescriptions/verify", { token: patientToken, body: { prescriptionId: `0x${"b".repeat(64)}`, patientHash: `0x${"b".repeat(64)}` } });
    assert.equal(outOfScope.status, 403);
    const deniedRevoke = await call(app, "POST", "/api/v1/prescriptions/revoke", { token: patientToken, body: { prescriptionId, reason: "Correction" } });
    assert.equal(deniedRevoke.status, 403);
    const doctorToken = await login(app, doctor);
    const revoked = await call(app, "POST", "/api/v1/prescriptions/revoke", { token: doctorToken, body: { prescriptionId, reason: "Correction" } });
    assert.equal(revoked.status, 410);
    assert.equal(revoked.body.error, "WALLET_TRANSACTION_REQUIRED");
    assert.equal(backendRevokeCalled, false);
  } finally { restore(); delete process.env.TEST_DOCTOR; }
});

test("dispense route requires pharmacy authorization and rejects backend submission", async () => {
  const pharmacy = new ethers.Wallet("0x" + "ab".repeat(32));
  process.env.TEST_PHARMACY = pharmacy.address;
  let backendWriteCalled = false;
  const { app, restore } = loadApp({ dispensePrescription: async () => { backendWriteCalled = true; } });
  try {
    const token = await login(app, pharmacy);
    const response = await call(app, "POST", "/api/v1/prescriptions/dispense", {
      token,
      body: { prescriptionId: `0x${"a".repeat(64)}`, patientHash: `0x${"b".repeat(64)}` },
    });
    assert.equal(response.status, 410);
    assert.equal(response.body.error, "WALLET_TRANSACTION_REQUIRED");
    assert.equal(backendWriteCalled, false);
  } finally { restore(); delete process.env.TEST_PHARMACY; }
});

test("failed patient hash verification is denied and does not echo patient hash markers", async () => {
  const patient = new ethers.Wallet("0x" + "11".repeat(32));
  const { app, restore } = loadApp({ verifyPrescription: async () => ({ success: true, data: { prescriptionId: "0xabc", patientHashVerified: false } }) });
  try {
    const token = await login(app, patient, true, `0x${"c".repeat(64)}`);
    const patientHash = `0x${"d".repeat(64)}`;
    const response = await call(app, "POST", "/api/v1/prescriptions/verify", { token, body: { prescriptionId: `0x${"c".repeat(64)}`, patientHash } });
    assert.equal(response.status, 403);
    assert.equal(response.body.error, "PATIENT_HASH_MISMATCH");
    assertMarkersAbsent(response.body, [patientHash]);
  } finally { restore(); }
});

test("challenge signatures are single use and expire", async () => {
  const doctor = new ethers.Wallet("0x" + "44".repeat(32));
  process.env.TEST_DOCTOR = doctor.address;
  const { app, restore } = loadApp();
  try {
    const challenge = (await call(app, "POST", "/api/v1/prescriptions/auth/challenge", { body: { address: doctor.address } })).body.data;
    const signature = await doctor.signMessage(challenge.message);
    assert.equal((await call(app, "POST", "/api/v1/prescriptions/auth/token", { body: { message: challenge.message, signature } })).status, 200);
    const replay = await call(app, "POST", "/api/v1/prescriptions/auth/token", { body: { message: challenge.message, signature } });
    assert.equal(replay.status, 401);
    assert.match(replay.body.message, /already used/);

    const auth = require("../middleware/auth");
    const oldIssuedAt = Math.floor(Date.now() / 1000) - auth.MAX_CHALLENGE_AGE_SECONDS - 1;
    const nonce = ethers.hexlify(ethers.randomBytes(16));
    const expiredMessage = ["MEDISAFE CHAIN Component 4 authentication", `Address: ${ethers.getAddress(doctor.address)}`, `Nonce: ${nonce}`, `Issued At: ${oldIssuedAt}`].join("\n");
    auth.issuedChallenges.set(nonce, { address: ethers.getAddress(doctor.address), issuedAt: oldIssuedAt, patient: false, prescriptionId: null });
    const expired = await call(app, "POST", "/api/v1/prescriptions/auth/token", { body: { message: expiredMessage, signature: await doctor.signMessage(expiredMessage) } });
    assert.equal(expired.status, 401);
    assert.match(expired.body.message, /expired/);
  } finally { restore(); delete process.env.TEST_DOCTOR; }
});

test("wallet role grants a session role without matching the service transaction signer", async () => {
  const pharmacy = new ethers.Wallet("0x" + "55".repeat(32));
  const original = require.cache[servicePath];
  require.cache[servicePath] = { id: servicePath, filename: servicePath, loaded: true, exports: {
    getProvider: () => ({ getNetwork: async () => ({ chainId: 31337n }), getCode: async () => "0x6001" }),
    getConfiguredSignerAddress: () => "0x0000000000000000000000000000000000000001",
    getContract: () => ({ getAddress: async () => "0x0000000000000000000000000000000000000003", DOCTOR_ROLE: async () => "doctor-role", PHARMACY_ROLE: async () => "pharmacy-role", hasRole: async (role, address) => role === "pharmacy-role" && address.toLowerCase() === pharmacy.address.toLowerCase() }),
  } };
  delete require.cache[require.resolve("../middleware/auth")];
  delete require.cache[require.resolve("../routes/prescriptionRoutes")];
  delete require.cache[require.resolve("../server")];
  process.env.AUTH_TOKEN_SECRET = "local-component4-test-secret-at-least-32-characters";
  const app = require("../server");
  try {
    const token = await login(app, pharmacy);
    const claims = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString());
    assert.deepEqual(claims.roles, ["pharmacy"]);
  } finally { if (original) require.cache[servicePath] = original; else delete require.cache[servicePath]; delete process.env.TEST_DOCTOR; }
});

test("invalid signatures, missing secret, and expired tokens are rejected safely", async () => {
  const doctor = new ethers.Wallet("0x" + "66".repeat(32));
  process.env.TEST_DOCTOR = doctor.address;
  const { app, restore } = loadApp();
  try {
    const challenge = (await call(app, "POST", "/api/v1/prescriptions/auth/challenge", { body: { address: doctor.address } })).body.data;
    const invalid = await call(app, "POST", "/api/v1/prescriptions/auth/token", { body: { message: challenge.message, signature: "0x1234" } });
    assert.equal(invalid.status, 401);
    assert.match(invalid.body.message, /invalid|malformed/i);

    process.env.AUTH_TOKEN_SECRET = "too-short";
    const missingSecret = await call(app, "POST", "/api/v1/prescriptions/auth/challenge", { body: { address: doctor.address } });
    assert.equal(missingSecret.status, 503);
    assert.match(missingSecret.body.message, /AUTH_TOKEN_SECRET/);

    process.env.AUTH_TOKEN_SECRET = "replace-with-at-least-32-random-characters";
    const templateSecret = await call(app, "POST", "/api/v1/prescriptions/auth/challenge", { body: { address: doctor.address } });
    assert.equal(templateSecret.status, 503);

    process.env.AUTH_TOKEN_SECRET = "local-component4-test-secret-at-least-32-characters";
    const { createHmac } = require("node:crypto");
    const payload = Buffer.from(JSON.stringify({ sub: doctor.address, roles: ["doctor"], iat: 1, exp: 2 })).toString("base64url");
    const sig = createHmac("sha256", process.env.AUTH_TOKEN_SECRET).update(payload).digest("base64url");
    const expiredToken = await call(app, "POST", "/api/v1/prescriptions/lookup", { token: `${payload}.${sig}`, body: { prescriptionId: `0x${"a".repeat(64)}` } });
    assert.equal(expiredToken.status, 401);
  } finally { restore(); delete process.env.TEST_DOCTOR; }
});

test("signed sessions with missing, malformed, or future-dated expiry claims fail closed", async () => {
  const doctor = new ethers.Wallet("0x" + "67".repeat(32));
  const { app, restore } = loadApp();
  const { createHmac } = require("node:crypto");
  const now = Math.floor(Date.now() / 1000);
  const signedToken = (claims) => {
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const signature = createHmac("sha256", process.env.AUTH_TOKEN_SECRET).update(payload).digest("base64url");
    return `${payload}.${signature}`;
  };
  try {
    const claims = { sub: doctor.address, roles: ["doctor"], iat: now, exp: now + 60 };
    for (const altered of [
      { ...claims, exp: undefined },
      { ...claims, exp: "not-a-timestamp" },
      { ...claims, iat: now + 60, exp: now + 120 },
      { ...claims, exp: now + 600 },
      { ...claims, roles: ["patient"], prescriptionId: "not-bytes32" },
    ]) {
      const response = await call(app, "POST", "/api/v1/prescriptions/lookup", {
        token: signedToken(altered),
        body: { prescriptionId: `0x${"a".repeat(64)}` },
      });
      assert.equal(response.status, 401);
      assert.equal(response.body.error, "UNAUTHORIZED");
    }
  } finally { restore(); }
});

test("patient challenge requires prescription scope and cannot grant professional roles", async () => {
  const patient = new ethers.Wallet("0x" + "77".repeat(32));
  const { app, restore } = loadApp();
  try {
    const missingScope = await call(app, "POST", "/api/v1/prescriptions/auth/challenge", { body: { address: patient.address, patient: true } });
    assert.equal(missingScope.status, 400);
    const token = await login(app, patient, true, `0x${"c".repeat(64)}`);
    const claims = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString());
    assert.deepEqual(claims.roles, ["patient"]);
    assert.equal("identityVerified" in claims, false);
  } finally { restore(); }
});

test("wallets without an on-chain professional role are denied a session", async () => {
  const wallet = new ethers.Wallet("0x" + "88".repeat(32));
  const { app, restore } = loadApp({ getContract: () => ({
    getAddress: async () => "0x0000000000000000000000000000000000000003",
    DOCTOR_ROLE: async () => "doctor-role",
    PHARMACY_ROLE: async () => "pharmacy-role",
    hasRole: async () => false,
  }) });
  try {
    const challenge = (await call(app, "POST", "/api/v1/prescriptions/auth/challenge", { body: { address: wallet.address } })).body.data;
    const response = await call(app, "POST", "/api/v1/prescriptions/auth/token", { body: { message: challenge.message, signature: await wallet.signMessage(challenge.message) } });
    assert.equal(response.status, 403);
    assert.equal(response.body.error, "FORBIDDEN");
  } finally { restore(); }
});

test("professional routes recheck the wallet role after a session is issued", async () => {
  const doctor = new ethers.Wallet("0x" + "8a".repeat(32));
  let roleIsActive = true;
  let backendWriteCalled = false;
  const { app, restore } = loadApp({
    getContract: () => ({
      getAddress: async () => "0x0000000000000000000000000000000000000003",
      DOCTOR_ROLE: async () => "doctor-role",
      PHARMACY_ROLE: async () => "pharmacy-role",
      hasRole: async (role, address) => roleIsActive && role === "doctor-role" && address.toLowerCase() === doctor.address.toLowerCase(),
    }),
    issuePrescription: async () => { backendWriteCalled = true; },
  });
  try {
    const token = await login(app, doctor);
    roleIsActive = false;
    const response = await call(app, "POST", "/api/v1/prescriptions/issue", {
      token,
      body: { patientHash: `0x${"a".repeat(64)}`, medicineId: "MED-1", batchId: "BATCH-1" },
    });
    assert.equal(response.status, 403);
    assert.equal(response.body.error, "FORBIDDEN");
    assert.match(response.body.message, /no longer has/i);
    assert.equal(backendWriteCalled, false);
  } finally { restore(); }
});

test("missing contract configuration returns a safe configuration error", async () => {
  const wallet = new ethers.Wallet("0x" + "99".repeat(32));
  const { app, restore } = loadApp({ getContract: () => { throw new Error('No contract addresses configured for network: "localhost"'); } });
  try {
    const challenge = (await call(app, "POST", "/api/v1/prescriptions/auth/challenge", { body: { address: wallet.address } })).body.data;
    const response = await call(app, "POST", "/api/v1/prescriptions/auth/token", { body: { message: challenge.message, signature: await wallet.signMessage(challenge.message) } });
    assert.equal(response.status, 503);
    assert.match(response.body.message, /PrescriptionRegistry is not configured/);
    assert.equal(JSON.stringify(response.body).includes("localhost\""), false);
  } finally { restore(); }
});

test("patient verification rejects raw identity payloads without echoing them", async () => {
  const patient = new ethers.Wallet("0x" + "aa".repeat(32));
  const { app, restore } = loadApp();
  try {
    const prescriptionId = `0x${"a".repeat(64)}`;
    const token = await login(app, patient, true, prescriptionId);
    const markers = [
      `0x${"c".repeat(64)}`,
      "SYNTHETIC-NATIONAL-ID-7F2A91",
      "SYNTHETIC-FULL-NAME-4C8B13",
      "SYNTHETIC-DOB-2001-02-03",
      `0x${"b".repeat(64)}`,
    ];
    const response = await call(app, "POST", "/api/v1/prescriptions/verify", {
      token,
      body: { prescriptionId, patientHash: markers[0], patientNationalId: markers[1], patientFullName: markers[2], patientDateOfBirth: markers[3], salt: markers[4] },
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, "VALIDATION_ERROR");
    assertMarkersAbsent(response.body, markers);
    assert.equal("value" in response.body.details[0], false);

    const missingHash = await call(app, "POST", "/api/v1/prescriptions/verify", {
      token,
      body: { prescriptionId, patientHash: "SYNTHETIC-MALFORMED-HASH-9D3E61" },
    });
    assert.equal(missingHash.status, 400);
    assert.equal(missingHash.body.error, "VALIDATION_ERROR");
    assertMarkersAbsent(missingHash.body, ["SYNTHETIC-MALFORMED-HASH-9D3E61"]);
  } finally { restore(); delete process.env.TEST_DOCTOR; }
});

test("patient hash verification reports an incorrect hash and expired prescription safely", async () => {
  const patient = new ethers.Wallet("0x" + "ac".repeat(32));
  const prescriptionId = `0x${"e".repeat(64)}`;
  const tokenAndCall = async (serviceError) => {
    const { app, restore } = loadApp({ verifyPrescription: async () => { throw serviceError; } });
    try {
      const token = await login(app, patient, true, prescriptionId);
      return await call(app, "POST", "/api/v1/prescriptions/verify", { token, body: { prescriptionId, patientHash: `0x${"f".repeat(64)}` } });
    } finally { restore(); }
  };
  try {
    const markers = [
      `0x${"f".repeat(64)}`,
      "SYNTHETIC-CONTROLLED-ERROR-NATIONAL-ID-2A6C",
      "SYNTHETIC-CONTROLLED-ERROR-NAME-8B1D",
      "SYNTHETIC-CONTROLLED-ERROR-DOB-2002-04-05",
      `0x${"9".repeat(64)}`,
    ];
    const mismatch = await tokenAndCall(Object.assign(new Error(`hash mismatch ${markers.join(" ")}`), { statusCode: 403, code: "PATIENT_HASH_MISMATCH" }));
    assert.equal(mismatch.status, 403);
    assert.equal(mismatch.body.error, "PATIENT_HASH_MISMATCH");
    assertMarkersAbsent(mismatch.body, markers);
    const expired = await tokenAndCall(Object.assign(new Error("This prescription has expired."), { statusCode: 410, code: "PRESCRIPTION_EXPIRED" }));
    assert.equal(expired.status, 410);
    assert.equal(expired.body.error, "PRESCRIPTION_EXPIRED");
  } finally { delete process.env.TEST_DOCTOR; }
});

test("malformed and oversized request bodies return safe API errors", async () => {
  const { app, restore } = loadApp();
  try {
    const malformed = await call(app, "POST", "/api/v1/prescriptions/auth/challenge", { rawBody: "SENSITIVE-MARKER-{" });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.error, "INVALID_JSON");
    assert.equal(JSON.stringify(malformed.body).includes("SENSITIVE-MARKER"), false);

    const oversized = await call(app, "POST", "/api/v1/prescriptions/auth/challenge", { rawBody: "x".repeat(17 * 1024) });
    assert.equal(oversized.status, 413);
    assert.equal(oversized.body.error, "REQUEST_TOO_LARGE");
  } finally { restore(); }
});

test("health and API responses apply configured CORS and privacy headers", async () => {
  const previousOrigin = process.env.CORS_ORIGIN;
  process.env.CORS_ORIGIN = "http://component4-test.invalid";
  const { app, restore } = loadApp();
  try {
    const response = await call(app, "GET", "/health");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://component4-test.invalid");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  } finally {
    if (previousOrigin === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = previousOrigin;
    restore();
  }
});

test("blockchain readiness endpoint returns dependency status and hides provider diagnostics", async () => {
  const { app, restore } = loadApp({
    getBlockchainStatus: async () => ({
      connected: true,
      chainId: 31337,
      prescriptionRegistry: "0x0000000000000000000000000000000000000003",
      riskRegistry: "0x0000000000000000000000000000000000000004",
      component3Connected: false,
    }),
  });
  try {
    const ready = await call(app, "GET", "/health/blockchain");
    assert.equal(ready.status, 200);
    assert.deepEqual(ready.body.data, {
      connected: true,
      chainId: 31337,
      prescriptionRegistry: "0x0000000000000000000000000000000000000003",
      riskRegistry: "0x0000000000000000000000000000000000000004",
      component3Connected: false,
    });
  } finally { restore(); }

  const marker = "provider credential diagnostic";
  const unavailable = loadApp({
    getBlockchainStatus: async () => { throw Object.assign(new Error(marker), { statusCode: 503, code: "RISK_REGISTRY_UNAVAILABLE" }); },
  });
  try {
    const response = await call(unavailable.app, "GET", "/health/blockchain");
    assert.equal(response.status, 503);
    assert.equal(response.body.error, "RISK_REGISTRY_UNAVAILABLE");
    assert.equal(JSON.stringify(response.body).includes(marker), false);
  } finally { unavailable.restore(); }
});

test("controller does not expose raw blockchain revert details", async () => {
  const doctor = new ethers.Wallet("0x" + "ad".repeat(32));
  process.env.TEST_DOCTOR = doctor.address;
  const marker = "REVERT-DETAIL-MUST-NOT-LEAK";
  const { app, restore } = loadApp({ getPrescription: async () => { throw Object.assign(new Error(marker), { code: "CALL_EXCEPTION" }); } });
  try {
    const token = await login(app, doctor);
    const response = await call(app, "POST", "/api/v1/prescriptions/lookup", { token, body: { prescriptionId: `0x${"a".repeat(64)}` } });
    assert.equal(response.status, 404);
    assert.equal(JSON.stringify(response.body).includes(marker), false);
  } finally { restore(); delete process.env.TEST_DOCTOR; }
});

test("doctor prescription lookup accepts the ID in the request body and enforces issuer ownership", async () => {
  const doctor = new ethers.Wallet("0x" + "ae".repeat(32));
  const otherDoctor = new ethers.Wallet("0x" + "af".repeat(32));
  process.env.TEST_DOCTOR = doctor.address;
  let recordRead = false;
  const { app, restore } = loadApp({
    getPrescriptionIssuer: async () => otherDoctor.address,
    getPrescription: async () => { recordRead = true; return { success: true, data: {} }; },
  });
  try {
    const token = await login(app, doctor);
    const prescriptionId = `0x${"b".repeat(64)}`;
    const response = await call(app, "POST", "/api/v1/prescriptions/lookup", { token, body: { prescriptionId } });
    assert.equal(response.status, 403);
    assert.equal(recordRead, false);
  } finally { restore(); delete process.env.TEST_DOCTOR; }
});

test("doctor prescription listing rejects unauthenticated requests", async () => {
  const { app, restore } = loadApp();
  try {
    const response = await call(app, "GET", "/api/v1/prescriptions/mine");
    assert.equal(response.status, 401);
    assert.equal(response.body.error, "UNAUTHORIZED");
  } finally { restore(); }
});

test("doctor prescription listing rejects non-doctor sessions", async () => {
  const pharmacy = new ethers.Wallet("0x" + "b1".repeat(32));
  process.env.TEST_PHARMACY = pharmacy.address;
  const { app, restore } = loadApp({ getPrescriptionsByDoctor: async () => { throw new Error("must not list for pharmacy"); } });
  try {
    const token = await login(app, pharmacy);
    const response = await call(app, "GET", "/api/v1/prescriptions/mine", { token });
    assert.equal(response.status, 403);
    assert.equal(response.body.error, "FORBIDDEN");
  } finally { restore(); delete process.env.TEST_PHARMACY; }
});

test("doctor prescription listing uses the authenticated doctor's address", async () => {
  const doctor = new ethers.Wallet("0x" + "b2".repeat(32));
  process.env.TEST_DOCTOR = doctor.address;
  let requestedAddress;
  const expected = { success: true, data: { doctorAddress: ethers.getAddress(doctor.address), prescriptionIds: [`0x${"1".repeat(64)}`], count: 1 } };
  const { app, restore } = loadApp({ getPrescriptionsByDoctor: async (address) => { requestedAddress = address; return expected; } });
  try {
    const token = await login(app, doctor);
    const response = await call(app, "GET", "/api/v1/prescriptions/mine", { token });
    assert.equal(response.status, 200);
    assert.equal(requestedAddress, ethers.getAddress(doctor.address));
    assert.deepEqual(response.body, expected);
  } finally { restore(); delete process.env.TEST_DOCTOR; }
});

test("doctor listing ignores a caller-supplied address and stays scoped to the authenticated doctor", async () => {
  const doctor = new ethers.Wallet("0x" + "b3".repeat(32));
  const otherDoctor = new ethers.Wallet("0x" + "b4".repeat(32));
  process.env.TEST_DOCTOR = doctor.address;
  let requestedAddress;
  const { app, restore } = loadApp({
    getPrescriptionsByDoctor: async (address) => {
      requestedAddress = address;
      return { success: true, data: { doctorAddress: ethers.getAddress(address), prescriptionIds: [], count: 0 } };
    },
  });
  try {
    const token = await login(app, doctor);
    const response = await call(app, "GET", `/api/v1/prescriptions/mine?doctorAddress=${otherDoctor.address}`, { token });
    assert.equal(response.status, 200);
    assert.equal(requestedAddress, ethers.getAddress(doctor.address));
    assert.notEqual(requestedAddress.toLowerCase(), otherDoctor.address.toLowerCase());
    assert.equal(response.body.data.doctorAddress, ethers.getAddress(doctor.address));
  } finally { restore(); delete process.env.TEST_DOCTOR; }
});

test("doctor prescription listing returns an empty list when the doctor has no prescriptions", async () => {
  const doctor = new ethers.Wallet("0x" + "b5".repeat(32));
  process.env.TEST_DOCTOR = doctor.address;
  const { app, restore } = loadApp({
    getPrescriptionsByDoctor: async (address) => ({ success: true, data: { doctorAddress: ethers.getAddress(address), prescriptionIds: [], count: 0 } }),
  });
  try {
    const token = await login(app, doctor);
    const response = await call(app, "GET", "/api/v1/prescriptions/mine", { token });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data.prescriptionIds, []);
    assert.equal(response.body.data.count, 0);
  } finally { restore(); delete process.env.TEST_DOCTOR; }
});

test("doctor prescription listing reports blockchain read failures safely", async () => {
  const doctor = new ethers.Wallet("0x" + "b6".repeat(32));
  process.env.TEST_DOCTOR = doctor.address;
  const diagnostic = "BLOCKCHAIN-READ-SECRET-DIAGNOSTIC";
  const { app, restore } = loadApp({
    getPrescriptionsByDoctor: async () => { throw Object.assign(new Error(diagnostic), { statusCode: 503, code: "BLOCKCHAIN_READ_FAILED" }); },
  });
  try {
    const token = await login(app, doctor);
    const response = await call(app, "GET", "/api/v1/prescriptions/mine", { token });
    assert.equal(response.status, 503);
    assert.equal(response.body.error, "BLOCKCHAIN_READ_FAILED");
    assert.equal(JSON.stringify(response.body).includes(diagnostic), false);
  } finally { restore(); delete process.env.TEST_DOCTOR; }
});

test("challenge storage is bounded under repeated challenge requests", async () => {
  const { app, restore } = loadApp();
  const auth = require("../middleware/auth");
  try {
    const issuedAt = Math.floor(Date.now() / 1000);
    for (let index = 0; index < auth.MAX_PENDING_CHALLENGES; index += 1) {
      auth.issuedChallenges.set(`capacity-${index}`, { address: "0x0000000000000000000000000000000000000001", issuedAt, patient: false, prescriptionId: null });
    }
    const response = await call(app, "POST", "/api/v1/prescriptions/auth/challenge", { body: { address: "0x0000000000000000000000000000000000000001" } });
    assert.equal(response.status, 429);
    assert.equal(response.body.error, "CHALLENGE_CAPACITY_REACHED");
  } finally { auth.issuedChallenges.clear(); restore(); }
});
