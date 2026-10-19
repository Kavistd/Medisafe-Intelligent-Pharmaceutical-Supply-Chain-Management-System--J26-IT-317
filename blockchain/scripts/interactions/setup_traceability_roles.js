const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { address, checkNetwork, readAddresses, paths } = require("../lib/traceability");

const roles = ["MANUFACTURER_ROLE", "DISTRIBUTOR_ROLE", "PHARMACY_ROLE", "RECALL_ROLE"];

function validateAssignments(config) {
  if (!config || typeof config !== "object" || Array.isArray(config) ||
      Object.keys(config).some(key => !roles.includes(key))) throw new Error("Role file contains unsupported keys.");
  const assignments = [];
  for (const role of roles) {
    if (!Array.isArray(config[role])) throw new Error(`Role file must contain a ${role} array.`);
    for (const account of new Set(config[role].map(value => address(value, role)))) assignments.push({ role, account });
  }
  if (!assignments.length) throw new Error("Role file contains no participants.");
  return assignments;
}

async function main(options = {}) {
  const runtime = options.hre || hre;
  const env = options.env || process.env;
  const network = await checkNetwork(runtime, env);
  let config = options.assignments;
  if (!config) {
    if (!env.TRACEABILITY_ROLES_FILE) throw new Error("Set TRACEABILITY_ROLES_FILE to a participant JSON file.");
    config = JSON.parse(fs.readFileSync(path.resolve(env.TRACEABILITY_ROLES_FILE), "utf8"));
  }
  // Validate every account before sending any transaction.
  const assignments = validateAssignments(config);
  const configuredAddress = env.CONTRACT_ADDRESS_TRACEABILITY ||
    readAddresses(options.addressesPath || paths.addresses, network)[network].MedicineTraceability;
  const contractAddress = address(configuredAddress, "MedicineTraceability");
  const artifact = await runtime.artifacts.readArtifact("MedicineTraceability");
  const code = await runtime.ethers.provider.getCode(contractAddress);
  if (code.toLowerCase() !== artifact.deployedBytecode.toLowerCase())
    throw new Error("Configured address does not contain the compiled MedicineTraceability contract.");
  const signers = await runtime.ethers.getSigners();
  const requestedSigner = env.TRACEABILITY_SIGNER ? address(env.TRACEABILITY_SIGNER, "TRACEABILITY_SIGNER") : undefined;
  const signer = requestedSigner ? signers.find(account => account.address === requestedSigner) : signers[0];
  if (!signer) throw new Error("No role administrator signer configured.");
  const contract = await runtime.ethers.getContractAt("MedicineTraceability", contractAddress, signer);
  if (!await contract.hasRole(await contract.DEFAULT_ADMIN_ROLE(), signer.address))
    throw new Error("Signer is not the traceability administrator.");
  const result = [];
  for (const { role, account } of assignments) {
    const roleId = await contract[role]();
    const existing = await contract.hasRole(roleId, account);
    let transactionHash;
    if (!existing) {
      const receipt = await (await contract.grantRole(roleId, account)).wait();
      transactionHash = receipt.hash;
    }
    const entry = { role, account, status: existing ? "already-granted" : "granted", transactionHash };
    result.push(entry);
    if (!options.quiet) console.log(JSON.stringify(entry));
  }
  return result;
}

if (require.main === module) main().catch(() => {
  console.error("Role setup failed. Check approval, network, contract address, participant file and administrator signer. Grants are separate transactions; rerunning skips existing grants.");
  process.exitCode = 1;
});

module.exports = main;
module.exports.validateAssignments = validateAssignments;
