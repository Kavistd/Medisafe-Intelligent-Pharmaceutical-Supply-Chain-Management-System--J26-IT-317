const { expect } = require("chai");
const fs = require("fs");
const os = require("os");
const path = require("path");
const hre = require("hardhat");
const { ethers } = hre;
const deploy = require("../../scripts/deploy/deploy_traceability");
const exportAbi = require("../../scripts/deploy/export_traceability_abi");
const setupRoles = require("../../scripts/interactions/setup_traceability_roles");
const { checkNetwork, writeAddress } = require("../../scripts/lib/traceability");

async function rejects(promise, message) {
  try { await promise; } catch (error) {
    expect(error.message).to.include(message);
    return;
  }
  throw new Error(`Expected rejection containing: ${message}`);
}

describe("Component 1: deployment and shared configuration", function () {
  let directory, addressesPath, abiPath, original, signers;
  beforeEach(async function () {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "medisafe-traceability-"));
    addressesPath = path.join(directory, "addresses.json");
    abiPath = path.join(directory, "MedicineTraceability.json");
    original = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../shared/blockchain/contract-addresses.json"), "utf8"));
    fs.writeFileSync(addressesPath, JSON.stringify(original));
    signers = await ethers.getSigners();
  });
  afterEach(function () {
    // Only the exact directory returned by mkdtemp above is removed.
    fs.rmSync(directory, { recursive: true, force: true });
  });

  function options(extra = {}) { return { env: {}, addressesPath, abiPath, quiet: true, ...extra }; }
  function assignments() {
    return { MANUFACTURER_ROLE: [signers[1].address], DISTRIBUTOR_ROLE: [signers[2].address],
      PHARMACY_ROLE: [signers[3].address], RECALL_ROLE: [signers[4].address] };
  }

  it("deploys with the signer as local admin, exports ABI and leaves ephemeral addresses unrecorded", async function () {
    const before = fs.readFileSync(addressesPath, "utf8");
    const result = await deploy(options());
    expect(await result.traceability.hasRole(await result.traceability.DEFAULT_ADMIN_ROLE(), signers[0].address)).to.equal(true);
    expect(await ethers.provider.getCode(result.contractAddress)).not.to.equal("0x");
    expect(result.receipt.status).to.equal(1);
    expect(fs.readFileSync(addressesPath, "utf8")).to.equal(before);
    const exported = JSON.parse(fs.readFileSync(abiPath, "utf8"));
    expect(exported).to.deep.equal({ contractName: "MedicineTraceability", abi: (await hre.artifacts.readArtifact("MedicineTraceability")).abi });
    expect(exported).not.to.have.property("bytecode");
  });

  it("uses an explicit administrator distinct from the deployer", async function () {
    const { traceability } = await deploy(options({ env: { TRACEABILITY_ADMIN: signers[5].address } }));
    const role = await traceability.DEFAULT_ADMIN_ROLE();
    expect(await traceability.hasRole(role, signers[5].address)).to.equal(true);
    expect(await traceability.hasRole(role, signers[0].address)).to.equal(false);
  });

  it("rejects invalid admins before sending a deployment", async function () {
    const nonce = await ethers.provider.getTransactionCount(signers[0].address);
    for (const value of [ethers.ZeroAddress, "invalid"]) {
      await rejects(deploy(options({ env: { TRACEABILITY_ADMIN: value } })), "nonzero Ethereum address");
    }
    expect(await ethers.provider.getTransactionCount(signers[0].address)).to.equal(nonce);
  });

  it("records only the actual deployed Component 1 address in a persistent network slot", async function () {
    const localRuntime = { ethers: hre.ethers, artifacts: hre.artifacts, network: { name: "localhost" } };
    const { contractAddress } = await deploy(options({ hre: localRuntime }));
    const updated = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
    expect(updated.localhost.MedicineTraceability).to.equal(contractAddress);
    updated.localhost.MedicineTraceability = original.localhost.MedicineTraceability;
    expect(updated).to.deep.equal(original);
  });

  it("rejects malformed address configuration before deployment", async function () {
    fs.writeFileSync(addressesPath, JSON.stringify({ localhost: {} }));
    const runtime = { ethers: hre.ethers, network: { name: "localhost" } };
    const nonce = await ethers.provider.getTransactionCount(signers[0].address);
    await rejects(deploy(options({ hre: runtime })), "Missing MedicineTraceability");
    expect(await ethers.provider.getTransactionCount(signers[0].address)).to.equal(nonce);
  });

  it("does not permit writing ephemeral, unsupported or invalid addresses", function () {
    for (const network of ["hardhat", "mainnet", "unknown"])
      expect(() => writeAddress(addressesPath, network, signers[1].address)).to.throw("Only persistent");
    expect(() => writeAddress(addressesPath, "localhost", ethers.ZeroAddress)).to.throw("nonzero Ethereum address");
  });

  it("exports a deterministic ABI identical to the checked-in shared ABI", async function () {
    await exportAbi({ outputPath: abiPath });
    const first = fs.readFileSync(abiPath, "utf8");
    await exportAbi({ outputPath: abiPath });
    expect(fs.readFileSync(abiPath, "utf8")).to.equal(first);
    expect(JSON.parse(first)).to.deep.equal(require("../../../shared/abis/MedicineTraceability.json"));
  });

  it("blocks unapproved Sepolia, unsupported networks and wrong chain IDs without external calls", async function () {
    const runtime = (name, chainId) => ({ network: { name }, ethers: { provider: { getNetwork: async () => ({ chainId }) } } });
    await rejects(checkNetwork(runtime("sepolia", 11155111n), {}), "explicit approval");
    await rejects(checkNetwork(runtime("mainnet", 1n), {}), "Unsupported");
    await rejects(checkNetwork(runtime("localhost", 1n), {}), "chain ID");
    await rejects(checkNetwork(runtime("sepolia", 1n), { TRACEABILITY_ALLOW_SEPOLIA: "true" }), "chain ID");
    expect(await checkNetwork(runtime("sepolia", 11155111n), { TRACEABILITY_ALLOW_SEPOLIA: "true" })).to.equal("sepolia");
  });

  it("grants all four roles and safely skips existing grants on rerun", async function () {
    const { traceability, contractAddress } = await deploy(options());
    const roleOptions = options({ assignments: assignments(), env: { CONTRACT_ADDRESS_TRACEABILITY: contractAddress } });
    const first = await setupRoles(roleOptions);
    expect(first.map(entry => entry.status)).to.deep.equal(Array(4).fill("granted"));
    for (const entry of first) {
      expect(await traceability.hasRole(await traceability[entry.role](), entry.account)).to.equal(true);
      expect(entry.transactionHash).to.match(/^0x[0-9a-f]{64}$/);
    }
    const nonce = await ethers.provider.getTransactionCount(signers[0].address);
    expect((await setupRoles(roleOptions)).map(entry => entry.status)).to.deep.equal(Array(4).fill("already-granted"));
    expect(await ethers.provider.getTransactionCount(signers[0].address)).to.equal(nonce);
  });

  it("loads participant files and resolves the contract from the selected network slot", async function () {
    const { contractAddress } = await deploy(options());
    const file = path.join(directory, "roles.json");
    fs.writeFileSync(file, JSON.stringify(assignments()));
    const config = { ...original, hardhat: { ...original.hardhat, MedicineTraceability: contractAddress } };
    fs.writeFileSync(addressesPath, JSON.stringify(config));
    const result = await setupRoles(options({ env: { TRACEABILITY_ROLES_FILE: file } }));
    expect(result).to.have.length(4);
  });

  it("rejects non-admin signers before granting any roles", async function () {
    const { contractAddress } = await deploy(options({ env: { TRACEABILITY_ADMIN: signers[5].address } }));
    const nonce = await ethers.provider.getTransactionCount(signers[0].address);
    await rejects(setupRoles(options({ assignments: assignments(), env: { CONTRACT_ADDRESS_TRACEABILITY: contractAddress } })), "not the traceability administrator");
    expect(await ethers.provider.getTransactionCount(signers[0].address)).to.equal(nonce);
  });

  it("allows an explicitly selected configured administrator signer", async function () {
    const { contractAddress } = await deploy(options({ env: { TRACEABILITY_ADMIN: signers[5].address } }));
    const result = await setupRoles(options({ assignments: assignments(), env: {
      CONTRACT_ADDRESS_TRACEABILITY: contractAddress, TRACEABILITY_SIGNER: signers[5].address,
    } }));
    expect(result.map(entry => entry.status)).to.deep.equal(Array(4).fill("granted"));
    await rejects(setupRoles(options({ assignments: assignments(), env: {
      CONTRACT_ADDRESS_TRACEABILITY: contractAddress, TRACEABILITY_SIGNER: ethers.Wallet.createRandom().address,
    } })), "No role administrator signer configured");
  });

  it("requires an explicit administrator for Sepolia before deploying", async function () {
    // Stub only the network query; no Sepolia provider or public transaction is used.
    const runtime = { network: { name: "sepolia" }, ethers: {
      provider: { getNetwork: async () => ({ chainId: 11155111n }) },
      getSigners: async () => signers,
      getContractFactory: async () => { throw new Error("Must not reach deployment"); },
    } };
    await rejects(deploy(options({ hre: runtime, env: { TRACEABILITY_ALLOW_SEPOLIA: "true" } })), "TRACEABILITY_ADMIN must be");
  });

  it("rejects absent, invalid, empty-code and other-component contract targets", async function () {
    const other = await ethers.deployContract("MedicineRiskRegistry", [signers[0].address]);
    for (const target of ["invalid", ethers.ZeroAddress, signers[1].address, await other.getAddress()]) {
      await rejects(setupRoles(options({ assignments: assignments(), env: { CONTRACT_ADDRESS_TRACEABILITY: target } })),
        ethers.isAddress(target) && target !== ethers.ZeroAddress ? "does not contain" : "nonzero Ethereum address");
    }
    await rejects(setupRoles(options({ assignments: assignments() })), "nonzero Ethereum address");
    await rejects(setupRoles(options()), "TRACEABILITY_ROLES_FILE");
  });

  it("validates all assignments before granting and rejects unsupported administrator grants", async function () {
    const { contractAddress } = await deploy(options());
    const nonce = await ethers.provider.getTransactionCount(signers[0].address);
    for (const config of [
      { ...assignments(), RECALL_ROLE: ["invalid"] },
      { ...assignments(), PHARMACY_ROLE: [ethers.ZeroAddress] },
      { ...assignments(), DEFAULT_ADMIN_ROLE: [signers[1].address] },
      { ...assignments(), DISTRIBUTOR_ROLE: "invalid" },
      { MANUFACTURER_ROLE: [], DISTRIBUTOR_ROLE: [], PHARMACY_ROLE: [], RECALL_ROLE: [] },
    ]) {
      let failed = false;
      try { await setupRoles(options({ assignments: config, env: { CONTRACT_ADDRESS_TRACEABILITY: contractAddress } })); }
      catch { failed = true; }
      expect(failed).to.equal(true);
    }
    expect(await ethers.provider.getTransactionCount(signers[0].address)).to.equal(nonce);
  });

  it("deduplicates participant addresses within each role", function () {
    const config = assignments();
    config.MANUFACTURER_ROLE.push(signers[1].address.toLowerCase());
    expect(setupRoles.validateAssignments(config)).to.have.length(4);
  });
});
