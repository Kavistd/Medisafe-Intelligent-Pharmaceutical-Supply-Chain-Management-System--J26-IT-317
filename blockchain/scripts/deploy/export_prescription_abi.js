const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const defaultOutput = path.resolve(
  __dirname,
  "../../../shared/abis/PrescriptionRegistry.json"
);

async function main(options = {}) {
  const artifact = await (options.hre || hre).artifacts.readArtifact(
    "PrescriptionRegistry"
  );
  const output = { contractName: artifact.contractName, abi: artifact.abi };
  const outputPath = options.outputPath || defaultOutput;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return output;
}

if (require.main === module) {
  main().catch(() => {
    console.error(
      "ABI export failed. Compile PrescriptionRegistry and check output permissions."
    );
    process.exitCode = 1;
  });
}

module.exports = main;
