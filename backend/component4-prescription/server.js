/**
 * @file server.js
 * @description Express API server for Component 4 prescription management.
 * @author R.A.M.A. Ranasinghe (IT23142978) - Component 4
 */

const express = require("express");
const path = require("path");
const fs = require("fs");
const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  for (const rawLine of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}
const prescriptionRoutes = require("./routes/prescriptionRoutes");
const { getBlockchainHealth } = require("./controllers/prescriptionController");

const app = express();
const PORT = Number(process.env.PORT) || 5004;

app.use(express.json({ limit: "16kb" }));

app.use((req, res, next) => {
  const origin = process.env.CORS_ORIGIN || "http://localhost:5173";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  return next();
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "component4-prescription",
    component: 4,
    author: "R.A.M.A. Ranasinghe (IT23142978)",
    port: PORT,
  });
});

app.get("/health/blockchain", getBlockchainHealth);

app.use("/api/v1/prescriptions", prescriptionRoutes);

app.use((error, _req, res, _next) => {
  if (error?.type === "entity.too.large") {
    return res.status(413).json({ success: false, error: "REQUEST_TOO_LARGE", message: "Request body exceeds the allowed size." });
  }
  if (error instanceof SyntaxError && error.status === 400 && Object.prototype.hasOwnProperty.call(error, "body")) {
    return res.status(400).json({ success: false, error: "INVALID_JSON", message: "Request body must be valid JSON." });
  }
  return res.status(500).json({ success: false, error: "INTERNAL_ERROR", message: "The Component 4 API could not complete this request." });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Component 4 Prescription API listening on http://localhost:${PORT}`);
    console.log(`Health: http://localhost:${PORT}/health`);
  });
}

module.exports = app;
