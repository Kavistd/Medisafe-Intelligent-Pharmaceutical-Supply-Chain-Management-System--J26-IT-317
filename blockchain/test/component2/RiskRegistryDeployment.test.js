const { expect } = require("chai");
const fs = require("fs");
const os = require("os");
const path = require("path");
const hre = require("hardhat");
const { ethers } = hre;

const deploy = require("../../scripts/deploy/deploy_risk_registry");
const {
  checkNetwork,
  writeAddress,
} = require("../../scripts/lib/risk-registry");

async function rejects(promise, message) {
  try {
    await promise;
  } catch (error) {
    expect(error.message).to.include(message);
    return;
  }
  throw new Error(`Expected rejection containing: ${message}`);
}

describe("Component 2: deployment and address configuration", function () {
  let directory;
  let addressesPath;
  let original;
  let signers;

  beforeEach(async function () {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "medisafe-risk-registry-"));
    addressesPath = path.join(directory, "addresses.json");
    original = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, "../../../shared/blockchain/contract-addresses.json"),
        "utf8"
      )
    );
    fs.writeFileSync(addressesPath, JSON.stringify(original));
    signers = await ethers.getSigners();
  });

  afterEach(function () {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  function options(extra = {}) {
    return { env: {}, addressesPath, quiet: true, ...extra };
  }

  it("deploys with the local signer as admin and does not record ephemeral addresses", async function () {
    const before = fs.readFileSync(addressesPath, "utf8");

    const result = await deploy(options());

    expect(await ethers.provider.getCode(result.contractAddress)).not.to.equal("0x");
    expect(result.receipt.status).to.equal(1);
    expect(
      await result.registry.hasRole(
        await result.registry.DEFAULT_ADMIN_ROLE(),
        signers[0].address
      )
    ).to.equal(true);
    expect(fs.readFileSync(addressesPath, "utf8")).to.equal(before);
  });

  it("supports an explicit administrator distinct from the deployer", async function () {
    const { registry } = await deploy(
      options({ env: { RISK_REGISTRY_ADMIN: signers[3].address } })
    );
    const role = await registry.DEFAULT_ADMIN_ROLE();

    expect(await registry.hasRole(role, signers[3].address)).to.equal(true);
    expect(await registry.hasRole(role, signers[0].address)).to.equal(false);
  });

  it("rejects invalid administrators before sending a deployment", async function () {
    const nonce = await ethers.provider.getTransactionCount(signers[0].address);

    for (const value of [ethers.ZeroAddress, "invalid"]) {
      await rejects(
        deploy(options({ env: { RISK_REGISTRY_ADMIN: value } })),
        "nonzero Ethereum address"
      );
    }

    expect(await ethers.provider.getTransactionCount(signers[0].address)).to.equal(
      nonce
    );
  });

  it("records the deployed address in a persistent localhost slot", async function () {
    const localRuntime = {
      ethers: hre.ethers,
      network: { name: "localhost" },
    };

    const { contractAddress } = await deploy(options({ hre: localRuntime }));
    const updated = JSON.parse(fs.readFileSync(addressesPath, "utf8"));

    expect(updated.localhost.MedicineRiskRegistry).to.equal(contractAddress);
    updated.localhost.MedicineRiskRegistry =
      original.localhost.MedicineRiskRegistry;
    expect(updated).to.deep.equal(original);
  });

  it("rejects malformed address configuration before deployment", async function () {
    fs.writeFileSync(addressesPath, JSON.stringify({ localhost: {} }));
    const runtime = { ethers: hre.ethers, network: { name: "localhost" } };
    const nonce = await ethers.provider.getTransactionCount(signers[0].address);

    await rejects(
      deploy(options({ hre: runtime })),
      "Missing MedicineRiskRegistry"
    );
    expect(await ethers.provider.getTransactionCount(signers[0].address)).to.equal(
      nonce
    );
  });

  it("does not record ephemeral, unsupported, or invalid addresses", function () {
    for (const network of ["hardhat", "mainnet", "unknown"]) {
      expect(() =>
        writeAddress(addressesPath, network, signers[1].address)
      ).to.throw("Only persistent");
    }
    expect(() =>
      writeAddress(addressesPath, "localhost", ethers.ZeroAddress)
    ).to.throw("nonzero Ethereum address");
  });

  it("blocks unapproved Sepolia, unsupported networks, and wrong chain IDs", async function () {
    const runtime = (name, chainId) => ({
      network: { name },
      ethers: { provider: { getNetwork: async () => ({ chainId }) } },
    });

    await rejects(checkNetwork(runtime("sepolia", 11155111n), {}), "explicit approval");
    await rejects(checkNetwork(runtime("mainnet", 1n), {}), "Unsupported");
    await rejects(checkNetwork(runtime("localhost", 1n), {}), "chain ID");
    await rejects(
      checkNetwork(runtime("sepolia", 1n), {
        RISK_REGISTRY_ALLOW_SEPOLIA: "true",
      }),
      "chain ID"
    );
    expect(
      await checkNetwork(runtime("sepolia", 11155111n), {
        RISK_REGISTRY_ALLOW_SEPOLIA: "true",
      })
    ).to.equal("sepolia");
  });

  it("requires an explicit administrator for Sepolia", async function () {
    const runtime = {
      network: { name: "sepolia" },
      ethers: {
        provider: { getNetwork: async () => ({ chainId: 11155111n }) },
        getSigners: async () => signers,
        getContractFactory: async () => {
          throw new Error("Must not reach deployment");
        },
      },
    };

    await rejects(
      deploy(
        options({
          hre: runtime,
          env: { RISK_REGISTRY_ALLOW_SEPOLIA: "true" },
        })
      ),
      "RISK_REGISTRY_ADMIN must be"
    );
  });
});
