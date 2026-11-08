#!/usr/bin/env node
/**
 * Read-only private HTTP handshake probe, run inside the deployed ais-web image.
 * No service tokens, passwords, e-mails, URLs or raw response bodies are logged.
 * A PASS does not attest DEBUG, cryptographic entropy or external production.
 */
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const PLACEHOLDERS = new Set([
  'change_me', 'change-me', 'changeme', 'auth_service_token',
  'auth-service-token', 'your-auth-service-token', 'placeholder',
  'secret', 'token', 'local-development-auth-service-token-not-for-production',
]);
const AUTH_ROUTES = ['/auth/register', '/auth/login', '/auth/verify-password'];

export function privateOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('private origin is required'); }
  const hostname = url.hostname.toLowerCase();
  const allowed = ['127.0.0.1', 'localhost', 'auth-service', 'ais-auth'].includes(hostname)
    || hostname.endsWith('.railway.internal');
  if (!['http:', 'https:'].includes(url.protocol) || !allowed || url.username || url.password
      || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash)
    throw new Error('private auth-service origin is required');
  return url.origin;
}

export function usableToken(value) {
  return typeof value === 'string' && value.length >= 32 && /^[\x21-\x7e]+$/.test(value)
    && !PLACEHOLDERS.has(value.toLowerCase()) && new Set(value).size > 1;
}

async function request(origin, path, { method = 'POST', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token !== undefined) headers['X-Auth-Service-Token'] = token;
  const response = await fetch(origin + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(6000),
  });
  const data = await response.json();
  return { status: response.status, data };
}

export async function runProbe(env = process.env) {
  if (env.AIS_AUTH_PRIVATE_PROBE !== '1') throw new Error('operator opt-in is required');
  const origin = privateOrigin(env.AUTH_SERVICE_URL || '');
  const token = env.AUTH_SERVICE_TOKEN;
  if (!usableToken(token)) throw new Error('shared credential is missing or unusable');
  const expected = env.AIS_EXPECTED_SOURCE_SHA || '';
  if (!/^[a-f0-9]{40}$/.test(expected) || env.RAILWAY_GIT_COMMIT_SHA !== expected)
    throw new Error('deployed source identity is not established');

  const email = `boundary-probe-${randomBytes(8).toString('hex')}@example.com`;
  const login = { email, password: 'NonexistentProbePassword123!' };
  const register = { ...login, name: 'Synthetic boundary probe' };
  const wrong = (token[0] === 'Z' ? 'Y' : 'Z') + token.slice(1);
  const checks = [];
  const record = (name, actual, expectedValue) => checks.push({
    name, status: JSON.stringify(actual) === JSON.stringify(expectedValue) ? 'PASS' : 'FAIL',
  });
  try {
    const health = await request(origin, '/auth/health', { method: 'GET' });
    record('private_readiness_200', [health.status, health.data?.status], [200, 'healthy']);
    for (const path of AUTH_ROUTES) {
      const payload = path.endsWith('register') ? register : login;
      for (const [label, presented] of [['missing', undefined], ['wrong', wrong]]) {
        const res = await request(origin, path, { body: payload, token: presented });
        record(`${path.split('/').at(-1)}_${label}_401`, [res.status, res.data?.detail],
          [401, 'Service credential required.']);
      }
    }
    const validLogin = await request(origin, '/auth/login', { body: login, token });
    record('valid_token_reaches_login_logic', [validLogin.status, validLogin.data?.detail],
      [401, 'Invalid email or password.']);
    const validVerify = await request(origin, '/auth/verify-password', { body: login, token });
    record('valid_token_reaches_verification_logic', [validVerify.status, validVerify.data?.success],
      [200, false]);
  } catch {
    checks.push({ name: 'private_transport_or_protocol', status: 'FAIL' });
  }
  const passed = checks.filter(c => c.status === 'PASS').length;
  return {
    format: 'ais.private-auth-boundary-probe.v1', source_sha: expected,
    status: passed === 9 && checks.length === 9 ? 'PASS' : 'FAIL',
    passed, expected: 9, checks, secrets_in_receipt: false,
    scope: 'read-only private staging HTTP parity/denial; DEBUG and entropy require separate review',
  };
}

async function main() {
  let receipt;
  try { receipt = await runProbe(); } catch {
    receipt = { format: 'ais.private-auth-boundary-probe.v1', status: 'BLOCKED',
      reason: 'private target, opt-in, token or deployed source proof unavailable', secrets_in_receipt: false };
  }
  console.log(JSON.stringify(receipt));
  if (receipt.status !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
