import { ethers } from "ethers";
import fs from "fs";

async function main() {
  const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
  const accounts = await provider.listAccounts();
  const deployer = accounts[0]; // deployer / admin
  console.log("Deployer:", deployer.address);

  const regAddress = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
  const abi = JSON.parse(fs.readFileSync("src/component4/prescriptionRegistryAbi.json", "utf8"));
  const reg = new ethers.Contract(regAddress, abi, deployer);

  const DOCTOR_ROLE = await reg.DOCTOR_ROLE();
  const PHARMACY_ROLE = await reg.PHARMACY_ROLE();

  // Doctor: 0x2a13ee1f4c69386864a271bceb401fcd3d91c942
  // Pharmacy: 0x7465C8b4C7a9068c440044222539f993bf4537A7
  const doctor = "0x2a13ee1f4c69386864a271bceb401fcd3d91c942";
  const pharmacy = "0x7465C8b4C7a9068c440044222539f993bf4537A7";

  console.log("Granting DOCTOR_ROLE to:", doctor);
  const tx1 = await reg.grantRole(DOCTOR_ROLE, doctor);
  await tx1.wait();

  console.log("Granting PHARMACY_ROLE to:", pharmacy);
  const tx2 = await reg.grantRole(PHARMACY_ROLE, pharmacy);
  await tx2.wait();

  // Also fund MetaMask accounts with 10 ETH each if needed
  const targets = [
    doctor,
    "0x2376C6970c55AB66c4FFcad53A49fb21f862B613", // Patient
    pharmacy,
    "0xd2F150C082261e31F7504f129C799218186C4701"
  ];

  for (const t of targets) {
    const bal = await provider.getBalance(t);
    if (bal < ethers.parseEther("1.0")) {
      console.log(`Funding ${t} with 10 ETH...`);
      const txF = await deployer.sendTransaction({
        to: t,
        value: ethers.parseEther("10.0")
      });
      await txF.wait();
    }
  }

  console.log("Roles and funding configured successfully!");
}

main().catch(console.error);
