const assert = require("node:assert/strict");
const test = require("node:test");
const { ethers } = require("ethers");
const http = require("node:http");

const servicePath = require.resolve("../services/prescriptionService");

async function call(app, method, route, { token, body } = {}) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  } finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

function loadApp(serviceOverrides = {}) {
  const original = require.cache[servicePath];
  require.cache[servicePath] = {
    id: servicePath,
    filename: servicePath,
    loaded: true,
    exports: {
      getConfiguredSignerAddress: () => process.env.TEST_DOCTOR || "0x0000000000000000000000000000000000000001",
      getContract: () => ({
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

test("issue route requires doctor authorization and returns no patient hash", async () => {
  const doctor = new ethers.Wallet("0x" + "11".repeat(32));
  process.env.TEST_DOCTOR = doctor.address;
  const { app, restore } = loadApp({ issuePrescription: async () => ({ success: true, data: { prescriptionId: "0xabc", transactionHash: "0xtx" } }) });
  try {
    const response = await call(app, "POST", "/api/v1/prescriptions/issue", { body: { patientHash: "0x" + "a".repeat(64), medicineId: "MED-1", batchId: "BAT-1" } });
    assert.equal(response.status, 401);
    const token = await login(app, doctor);
    const issued = await call(app, "POST", "/api/v1/prescriptions/issue", { token, body: { patientHash: "0x" + "a".repeat(64), medicineId: "MED-1", batchId: "BAT-1" } });
    assert.equal(issued.status, 201);
    assert.equal(JSON.stringify(issued.body).includes("patientHash"), false);
  } finally { restore(); delete process.env.TEST_DOCTOR; }
});

test("verify and revoke routes enforce authorization and return controlled responses", async () => {
  const doctor = new ethers.Wallet("0x" + "22".repeat(32));
  const patient = new ethers.Wallet("0x" + "33".repeat(32));
  process.env.TEST_DOCTOR = doctor.address;
  const { app, restore } = loadApp({
    verifyPrescription: async () => ({ success: true, data: { prescriptionId: "0xabc", identityVerified: true, status: "ACTIVE" } }),
    revokePrescription: async () => ({ success: true, data: { prescriptionId: "0xabc", transactionHash: "0xtx" } }),
    getPrescriptionIssuer: async () => doctor.address,
  });
  try {
    const prescriptionId = `0x${"a".repeat(64)}`;
    const patientToken = await login(app, patient, true, prescriptionId);
    const verified = await call(app, "POST", `/api/v1/prescriptions/0x${"a".repeat(64)}/verify`, { token: patientToken, body: { patientNationalId: "ABC12345", patientFullName: "Example Person", patientDateOfBirth: "1990-01-01", salt: "0x" + "b".repeat(64) } });
    assert.equal(verified.status, 200);
    const deniedRevoke = await call(app, "POST", `/api/v1/prescriptions/0x${"a".repeat(64)}/revoke`, { token: patientToken, body: { reason: "Correction" } });
    assert.equal(deniedRevoke.status, 403);
    const doctorToken = await login(app, doctor);
    const revoked = await call(app, "POST", `/api/v1/prescriptions/0x${"a".repeat(64)}/revoke`, { token: doctorToken, body: { reason: "Correction" } });
    assert.equal(revoked.status, 200);
  } finally { restore(); delete process.env.TEST_DOCTOR; }
});

test("failed patient verification is denied and sensitive fields are not echoed", async () => {
  const patient = new ethers.Wallet("0x" + "11".repeat(32));
  const { app, restore } = loadApp({ verifyPrescription: async () => ({ success: true, data: { prescriptionId: "0xabc", identityVerified: false } }) });
  try {
    const token = await login(app, patient, true, `0x${"c".repeat(64)}`);
    const response = await call(app, "POST", `/api/v1/prescriptions/0x${"c".repeat(64)}/verify`, { token, body: { patientNationalId: "XYZ12345", patientFullName: "Example Person", patientDateOfBirth: "1990-01-01", salt: "0x" + "d".repeat(64) } });
    assert.equal(response.status, 403);
    assert.equal(JSON.stringify(response.body).includes("XYZ12345"), false);
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
    getConfiguredSignerAddress: () => "0x0000000000000000000000000000000000000001",
    getContract: () => ({ DOCTOR_ROLE: async () => "doctor-role", PHARMACY_ROLE: async () => "pharmacy-role", hasRole: async (role, address) => role === "pharmacy-role" && address.toLowerCase() === pharmacy.address.toLowerCase() }),
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
  } finally { if (original) require.cache[servicePath] = original; else delete require.cache[servicePath]; }
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

    process.env.AUTH_TOKEN_SECRET = "local-component4-test-secret-at-least-32-characters";
    const { createHmac } = require("node:crypto");
    const payload = Buffer.from(JSON.stringify({ sub: doctor.address, roles: ["doctor"], iat: 1, exp: 2 })).toString("base64url");
    const sig = createHmac("sha256", process.env.AUTH_TOKEN_SECRET).update(payload).digest("base64url");
    const expiredToken = await call(app, "GET", `/api/v1/prescriptions/${"a".repeat(64)}`, { token: `${payload}.${sig}` });
    assert.equal(expiredToken.status, 401);
  } finally { restore(); delete process.env.TEST_DOCTOR; }
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
  } finally { restore(); }
});
