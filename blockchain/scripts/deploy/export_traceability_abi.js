const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { paths } = require("../lib/traceability");

async function main(options = {}) {
  const artifact = await (options.hre || hre).artifacts.readArtifact("MedicineTraceability");
  const output = { contractName: artifact.contractName, abi: artifact.abi };
  const file = options.outputPath || paths.abi;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(output, null, 2) + "\n");
  return output;
}

if (require.main === module) main().catch(() => {
  console.error("ABI export failed. Compile MedicineTraceability first and check output permissions.");
  process.exitCode = 1;
});

module.exports = main;
