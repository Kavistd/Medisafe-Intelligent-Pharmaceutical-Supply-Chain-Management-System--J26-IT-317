import { apiRequest } from '../component4/api.js';
import { assertTokenRole, buildChallengeRequest, encodePersonalSignMessage } from '../component4/authFlow.js';
import { assertWalletContext } from '../component4/walletTransactions.js';
import { getMetaMaskProvider, requestLocalHardhatNetwork } from '../component4/walletProvider.js';

function tokenClaims(token) {
  if (typeof token !== 'string') throw new Error('Component 4 returned an invalid wallet session.');
  const encoded = token.split('.')[0];
  if (!encoded) throw new Error('Component 4 returned an invalid wallet session.');
  try {
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const payload = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
    return JSON.parse(payload);
  } catch {
    throw new Error('Component 4 returned an unreadable wallet session.');
  }
}

export async function createPharmacyWalletSession({
  getProvider = getMetaMaskProvider,
  requestApi = apiRequest,
  ensureLocalNetwork = requestLocalHardhatNetwork,
  assertContext = assertWalletContext,
  signableMessage = encodePersonalSignMessage,
} = {}) {
  const provider = await getProvider();
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  const address = accounts?.[0];
  if (!address) throw new Error('MetaMask did not provide a connected account.');
  const chainId = await ensureLocalNetwork(provider);
  await assertContext(provider, address);

  const challengeResponse = await requestApi('/api/v1/prescriptions/auth/challenge', {
    method: 'POST', body: buildChallengeRequest('pharmacy', address),
  });
  const message = challengeResponse?.data?.message;
  if (typeof message !== 'string' || !message) throw new Error('Component 4 returned an invalid wallet challenge.');
  let signature;
  try {
    signature = await provider.request({ method: 'personal_sign', params: [signableMessage(message), address] });
  } catch (error) {
    if (error?.code === 4001) throw new Error('Wallet signature was rejected.');
    throw new Error('MetaMask could not sign the pharmacy wallet challenge.');
  }
  await assertContext(provider, address);
  const signedChain = await provider.request({ method: 'eth_chainId' });
  if (String(signedChain).toLowerCase() !== String(chainId).toLowerCase()) {
    throw new Error('Wallet network changed during authentication. Try again.');
  }

  const tokenResponse = await requestApi('/api/v1/prescriptions/auth/token', {
    method: 'POST', body: { message, signature },
  });
  const token = tokenResponse?.data?.token;
  if (!token) throw new Error('Component 4 did not return a wallet session.');
  assertTokenRole(tokenClaims(token), 'pharmacy');
  await assertContext(provider, address);
  return Object.freeze({ token, address, provider });
}
