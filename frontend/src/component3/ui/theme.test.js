import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = path => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const CSS_FILES = ['./tokens.css', './shell.css', '../dashboard.css', '../live/live.css'];

test('tokens.css declares the light theme only', () => {
  const tokens = read('./tokens.css');
  assert.match(tokens, /:root\s*\{[^}]*color-scheme:\s*light/);
  assert.doesNotMatch(tokens, /color-scheme:\s*dark/);
  assert.match(tokens, /--c3-bg:\s*#f6f7fb/i);
  assert.match(tokens, /--c3-accent:\s*#4f46e5/i);
});

test('no Component 3 stylesheet follows the OS dark mode', () => {
  for (const file of CSS_FILES) {
    const css = read(file);
    assert.doesNotMatch(css, /prefers-color-scheme\s*:\s*dark/, file);
    assert.doesNotMatch(css, /data-theme\s*=\s*["']?dark/, file);
  }
});
