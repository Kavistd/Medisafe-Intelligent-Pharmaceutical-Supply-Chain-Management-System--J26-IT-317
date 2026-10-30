const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { paths } = require("../lib/risk-registry");

/** Export only the public ABI consumed by the Component 2 Python service. */
async function main(options = {}) {
  const artifact = await (options.hre || hre).artifacts.readArtifact(
    "MedicineRiskRegistry"
  );
  const outputPath = options.outputPath || paths.abi;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(artifact.abi, null, 2)}\n`);
  return artifact.abi;
}

if (require.main === module) {
  main().catch(() => {
    console.error(
      "ABI export failed. Compile MedicineRiskRegistry and check output permissions."
    );
    process.exitCode = 1;
  });
}

module.exports = main;
