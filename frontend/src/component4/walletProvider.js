const METAMASK_RDNS = "io.metamask";
const LOCAL_CHAIN_ID = "0x7a69";
const providerDetails = new WeakMap();

function isRequestProvider(provider) {
  return Boolean(provider && typeof provider.request === "function");
}

function isMetaMaskProvider(provider) {
  return isRequestProvider(provider) && provider.isMetaMask === true;
}

/** Select MetaMask explicitly, preferring its EIP-6963 provider identity. */
export async function getMetaMaskProvider({ ethereum, target = window } = {}) {
  const root = target || (typeof window !== "undefined" ? window : undefined);
  if (!root) throw new Error("MetaMask was not found. Install or enable the wallet extension and try again.");

  const discovered = new Map();
  const onAnnounce = (event) => {
    const detail = event?.detail;
    if (detail?.info?.rdns === METAMASK_RDNS && isRequestProvider(detail.provider)) {
      discovered.set(detail.provider, detail.info);
    }
  };

  if (typeof root.addEventListener === "function" && typeof root.dispatchEvent === "function") {
    root.addEventListener("eip6963:announceProvider", onAnnounce);
    root.dispatchEvent(new Event("eip6963:requestProvider"));
    await new Promise((resolve) => setTimeout(resolve, 80));
    root.removeEventListener("eip6963:announceProvider", onAnnounce);
  }

  if (discovered.size === 1) {
    const [provider, info] = discovered.entries().next().value;
    providerDetails.set(provider, { name: info.name || "MetaMask", source: "EIP-6963", rdns: info.rdns });
    return provider;
  }
  if (discovered.size > 1) {
    throw new Error("Multiple MetaMask wallets were detected. Disable duplicates and reload the page.");
  }

  const injected = ethereum || root.ethereum;
  const providers = Array.isArray(injected?.providers) ? injected.providers : [];
  const candidates = [...new Set((providers.length ? providers : [injected]).filter(isMetaMaskProvider))];
  if (candidates.length === 1) {
    const provider = candidates[0];
    providerDetails.set(provider, { name: "MetaMask-compatible injected wallet", source: "legacy isMetaMask flag" });
    return provider;
  }
  if (candidates.length > 1) {
    throw new Error("Multiple MetaMask providers were detected. Disable duplicates and reload the page.");
  }
  throw new Error("MetaMask was not found. Install or enable the wallet extension and try again.");
}

export function describeWalletProvider(provider) {
  return providerDetails.get(provider) || {
    name: provider?.isMetaMask === true ? "MetaMask-compatible injected wallet" : "Injected wallet provider",
    source: "provider object",
  };
}

/** Ask the wallet to use the local Hardhat chain; never treats a failed switch as success. */
export async function requestLocalHardhatNetwork(provider) {
  let chainId = await provider.request({ method: "eth_chainId" });
  if (BigInt(chainId) === 31337n) return chainId;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: LOCAL_CHAIN_ID }],
    });
  } catch (error) {
    if (error?.code === 4001) throw new Error("Network switch was cancelled in MetaMask.");
    if (error?.code !== 4902) {
      throw new Error("MetaMask could not switch to Hardhat Local. Confirm its RPC URL is http://127.0.0.1:8545 and that the Hardhat node is running.");
    }

    try {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: LOCAL_CHAIN_ID,
          chainName: "Hardhat Local",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["http://127.0.0.1:8545"],
        }],
      });
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: LOCAL_CHAIN_ID }],
      });
    } catch (addError) {
      if (addError?.code === 4001) throw new Error("Adding or switching to Hardhat Local was cancelled in MetaMask.");
      throw new Error("MetaMask could not add or connect to Hardhat Local. Confirm the local RPC URL http://127.0.0.1:8545 is reachable.");
    }
  }

  chainId = await provider.request({ method: "eth_chainId" });
  return chainId;
}
