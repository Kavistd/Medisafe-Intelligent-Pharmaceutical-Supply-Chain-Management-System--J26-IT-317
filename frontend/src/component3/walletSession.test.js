import test from 'node:test';
import assert from 'node:assert/strict';
import { createPharmacyWalletSession } from './walletSession.js';

const address = '0x1234567890123456789012345678901234567890';
const tokenFor = roles => `${Buffer.from(JSON.stringify({ roles })).toString('base64url')}.signature.payload`;

function walletProvider({ account = address, signature = 'signed-challenge' } = {}) {
  const calls = [];
  return {
    calls,
    async request(request) {
      calls.push(request);
      if (request.method === 'eth_requestAccounts') return [account];
      if (request.method === 'eth_chainId') return '0x7a69';
      if (request.method === 'personal_sign') return signature;
      throw new Error(`Unexpected provider method: ${request.method}`);
    },
  };
}

test('pharmacy wallet session signs a Component 4 challenge and requires pharmacy role', async () => {
  const provider = walletProvider();
  const apiCalls = [];
  const session = await createPharmacyWalletSession({
    getProvider: async () => provider,
    ensureLocalNetwork: async () => '0x7a69',
    assertContext: async () => {},
    signableMessage: message => `encoded:${message}`,
    requestApi: async (path, options) => {
      apiCalls.push({ path, options });
      return path.endsWith('/challenge')
        ? { data: { message: 'one-time challenge' } }
        : { data: { token: tokenFor(['pharmacy']) } };
    },
  });
  assert.equal(session.address, address);
  assert.equal(session.token.split('.')[0], tokenFor(['pharmacy']).split('.')[0]);
  assert.equal(apiCalls.length, 2);
  assert.equal(apiCalls[0].path, '/api/v1/prescriptions/auth/challenge');
  assert.deepEqual(apiCalls[0].options.body, { address });
  assert.deepEqual(apiCalls[1].options.body, { message: 'one-time challenge', signature: 'signed-challenge' });
  assert.equal(provider.calls.some(call => call.method === 'personal_sign'), true);
});

test('wallet session rejects signatures and Component 4 tokens without the pharmacy role', async () => {
  const provider = walletProvider();
  await assert.rejects(createPharmacyWalletSession({
    getProvider: async () => provider,
    ensureLocalNetwork: async () => '0x7a69',
    assertContext: async () => {},
    requestApi: async path => path.endsWith('/challenge')
      ? { data: { message: 'challenge' } } : { data: { token: tokenFor(['doctor']) } },
  }), /no on-chain pharmacy role/);

  const rejectingProvider = walletProvider();
  rejectingProvider.request = async request => {
    if (request.method === 'eth_requestAccounts') return [address];
    if (request.method === 'eth_chainId') return '0x7a69';
    if (request.method === 'personal_sign') throw Object.assign(new Error('rejected'), { code: 4001 });
    throw new Error('Unexpected method');
  };
  await assert.rejects(createPharmacyWalletSession({
    getProvider: async () => rejectingProvider,
    ensureLocalNetwork: async () => '0x7a69',
    assertContext: async () => {},
    requestApi: async () => ({ data: { message: 'challenge' } }),
  }), /signature was rejected/);
});
