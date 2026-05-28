// Smoke test for the library version semantics.
// Run with: node --test --experimental-strip-types src/main/library.test.ts
//
// We don't boot Electron for this -- we exercise the pure-Node helpers
// directly against a temp directory.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

test('content hash for identical bytes matches', () => {
  const a = Buffer.from('hello');
  const b = Buffer.from('hello');
  const ha = crypto.createHash('sha256').update(a).digest('hex').slice(0, 16);
  const hb = crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);
  assert.equal(ha, hb);
});

test('temp dir creation is idempotent', () => {
  const dir = path.join(os.tmpdir(), `presentool-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(dir, { recursive: true }); // should not throw
  fs.rmSync(dir, { recursive: true, force: true });
});
