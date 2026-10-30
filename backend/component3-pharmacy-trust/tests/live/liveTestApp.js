'use strict';

/**
 * Builds the live app around the in-memory fake c3 pool, a fake token verifier and a
 * fixed clock, and drives its request handler directly with in-memory request/response
 * objects (no port is opened, no network is used).
 */
const { Readable } = require('node:stream');
const { createLiveRepository } = require('../../services/live/liveRepository');
const { createLiveWriteRepository } = require('../../services/live/liveWriteRepository');
const { createLiveWorkspaceRepository } = require('../../services/live/liveWorkspaceRepository');
const { createLiveAuth } = require('../../services/live/liveAuth');
const { createLiveProcessService } = require('../../services/live/liveProcessService');
const { createLiveServer } = require('../../services/live/liveServer');
const { USERS, createFakeC3Pool } = require('./fakeC3Pool');

// JWT-shaped test tokens (three dot-separated parts) mapped to fake Supabase users.
const TOKENS = Object.freeze({
  regulator: 'test.token.regulator',
  pharmacyA: 'test.token.pharmacyA',
  pharmacyB: 'test.token.pharmacyB',
  distributor: 'test.token.distributor',
  suspended: 'test.token.suspended',
  noRole: 'test.token.noRole',
  expired: 'test.token.expired',
  serviceDown: 'test.token.serviceDown',
});

function fakeTokenVerifier(token) {
  if (token === TOKENS.serviceDown) return Promise.reject(new Error('Supabase Auth verification service is unavailable.'));
  const name = Object.keys(TOKENS).find(key => TOKENS[key] === token);
  return Promise.resolve(name && USERS[name] ? USERS[name] : null);
}

function createTestApp({ now = new Date('2026-10-02T00:00:00Z') } = {}) {
  const pool = createFakeC3Pool();
  let current = now;
  const clock = () => new Date(current.getTime());
  let refCounter = 0;
  const readRepository = createLiveRepository({ pool });
  const auth = createLiveAuth({ pool, readRepository, tokenVerifier: fakeTokenVerifier });
  const processService = createLiveProcessService({
    writeRepository: createLiveWriteRepository({ pool }), readRepository, clock,
    refFactory: prefix => `C3-${prefix}-TEST-${String(++refCounter).padStart(4, '0')}`,
  });
  const { handler } = createLiveServer({ auth, processService, workspaceRepository: createLiveWorkspaceRepository({ pool }), clock });
  return {
    pool, auth, handler,
    setNow: date => { current = new Date(date); },
    advanceHours: hours => { current = new Date(current.getTime() + hours * 3600 * 1000); },
  };
}

/** Drive the handler like an HTTP request. POST bodies default to {} as JSON. */
function call(handler, { method = 'GET', url, token, headers = {}, body, rawBody } = {}) {
  const payload = rawBody !== undefined ? rawBody : method === 'POST' ? JSON.stringify(body === undefined ? {} : body) : '';
  const req = Readable.from(payload ? [Buffer.from(payload)] : []);
  req.method = method;
  req.url = url;
  req.headers = {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(payload ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) } : {}),
    ...headers,
  };
  return new Promise((resolve, reject) => {
    const res = {
      headersSent: false,
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      writeHead(status, headerMap = {}) {
        this.statusCode = status;
        for (const [name, value] of Object.entries(headerMap)) this.headers[name.toLowerCase()] = value;
        this.headersSent = true;
      },
      end(data) {
        resolve({ status: this.statusCode, headers: this.headers, body: data ? JSON.parse(String(data)) : null });
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

module.exports = { TOKENS, USERS, createTestApp, call };
