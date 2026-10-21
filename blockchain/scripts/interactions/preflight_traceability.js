const hre = require('hardhat');
const { deploymentPreflight } = require('../lib/traceability-preflight');
async function main() {
  if (hre.network.name !== 'sepolia') throw new Error('Expected Sepolia.');
  const [signer] = await hre.ethers.getSigners();
  if (!signer) throw new Error('No configured signer.');
  const result = await deploymentPreflight({ network: hre.network.name, provider: hre.ethers.provider,
    artifact: await hre.artifacts.readArtifact('MedicineTraceability'), signerAddress: await signer.getAddress(),
    admin: process.env.TRACEABILITY_ADMIN });
  console.log(JSON.stringify({ ...result.report, deploymentEnabled: process.env.TRACEABILITY_ALLOW_SEPOLIA === 'true',
    transactionsSent: 0 }, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2));
}
if (require.main === module) main().catch(() => {
  console.error('Read-only preflight failed: check Sepolia chain, signer/admin, balance, fee/gas bounds and runtime simulation. Provider details withheld.');
  process.exitCode = 1;
});
module.exports = main;
