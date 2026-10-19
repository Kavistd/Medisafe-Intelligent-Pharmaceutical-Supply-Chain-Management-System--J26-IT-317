import { BrowserProvider, Contract } from "ethers";
import registryAbi from "./prescriptionRegistryAbi.json";
import contractAddresses from "../../../shared/blockchain/contract-addresses.json";
import { getMetaMaskProvider } from "./walletProvider.js";

export const REGISTRY_ADDRESS = contractAddresses.localhost.PrescriptionRegistry;
export const REGISTRY_ABI = registryAbi;

export async function createWalletRegistry(ethereum, address) {
  const wallet = ethereum || await getMetaMaskProvider();
  const provider = new BrowserProvider(wallet);
  const signer = await provider.getSigner(address);
  return new Contract(REGISTRY_ADDRESS, REGISTRY_ABI, signer);
}
