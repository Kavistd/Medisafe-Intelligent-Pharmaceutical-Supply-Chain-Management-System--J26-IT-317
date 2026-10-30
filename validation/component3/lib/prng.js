'use strict';

/**
 * Deterministic pseudo-random helpers for SYNTHETIC validation data only.
 * mulberry32 is a small 32-bit generator: the same seed always yields the same
 * sequence on every platform, which makes every validation output reproducible.
 */
function mulberry32(seed) {
  if (!Number.isInteger(seed)) throw new Error('PRNG seed must be an integer.');
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Inclusive integer in [min, max]. */
function randomInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Uniform real in [low, high). */
function uniform(rng, low, high) {
  return low + (high - low) * rng();
}

module.exports = { mulberry32, randomInt, uniform };
