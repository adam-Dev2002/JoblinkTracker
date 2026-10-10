import assert from 'node:assert/strict';
import { checkWrite } from '../jobfinder/preview/server/core.mjs';

const token = 'a'.repeat(64);
for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'https://preview.example.com']) {
  const request = (sentOrigin, csrf = token) => new Request(`${origin}/api/auth/login`, {
    headers: { Origin: sentOrigin, Cookie: `joblink_csrf=${token}`, 'X-CSRF-Token': csrf },
  });
  checkWrite(request(origin));
  assert.throws(() => checkWrite(request('https://untrusted.example')), /Invalid request origin/);
  assert.throws(() => checkWrite(request('null')), /Invalid request origin/);
  assert.throws(() => checkWrite(request(origin, '')), /Session expired/);
}
console.log('PASS: same-origin requests work on local and preview hosts; unrelated origins and missing CSRF are rejected.');
