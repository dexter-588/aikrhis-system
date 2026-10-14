'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../app');
const password = 'Long test password 42!';

async function fixture(t) {
  let clock = Date.now();
  const emails = [];
  const mailer = { available: true, async send(message) { emails.push(message); } };
  const server = createServer({ storage: 'sqlite', dbPath: ':memory:', now: () => clock, mailer });
  await server.ready;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await server.security.drainMail();
    await new Promise(resolve => server.close(resolve));
    await server.store.close();
  });
  async function request(endpoint, body, session) {
    const headers = {};
    if (session?.cookie) headers.Cookie = session.cookie;
    if (session?.csrfToken) headers['X-CSRF-Token'] = session.csrfToken;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`http://127.0.0.1:${server.address().port}${endpoint}`, {
      method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const registration = await request('/api/auth/register', { name: 'Test User', email: 'test@example.com', password });
  assert.equal(registration.status, 200);
  await server.security.drainMail();
  const session = { cookie: registration.cookie, csrfToken: registration.data.csrfToken };
  function token(purpose, index = emails.length - 1) {
    const link = emails[index].text.match(/http[^\s]+/)[0];
    return new URLSearchParams(new URL(link).hash.slice(1)).get(purpose === 'reset' ? 'reset-password' : 'verify-email');
  }
  return { server, request, emails, session, token, advance(ms) { clock += ms; } };
}

test('signup sends a hashed verification token; confirming unlocks cipher and prevents reuse', async t => {
  const f = await fixture(t);
  assert.equal(f.emails.length, 1);
  const token = f.token('verify');
  const pending = await f.server.store.find('settings', { kind: 'email-token' });
  assert.equal(pending.length, 1);
  assert.equal(JSON.stringify(pending).includes(token), false);
  const cipher = { cipher: 'caesar', mode: 'encrypt', text: 'hello', shift: 1 };
  assert.equal((await f.request('/api/cipher', cipher, f.session)).status, 403);
  assert.equal((await f.request('/api/auth/reset-password', { token, password })).status, 400);
  assert.equal((await f.request('/api/auth/verify-email', { token }, f.session)).status, 200);
  assert.equal((await f.request('/api/session', undefined, f.session)).data.user.emailVerified, true);
  assert.equal((await f.request('/api/cipher', cipher, f.session)).data.result, 'ifmmp');
  assert.equal((await f.request('/api/auth/verify-email', { token })).status, 400);
  const logs = await f.server.store.find('account_logs');
  assert.equal(JSON.stringify(logs).includes(token), false);
});

test('forgot password hides account existence; reset rejects weak passwords, revokes sessions and is single use', async t => {
  const f = await fixture(t);
  const missing = await f.request('/api/auth/forgot-password', { email: 'missing@example.com' });
  const existing = await f.request('/api/auth/forgot-password', { email: 'test@example.com' });
  assert.deepEqual(existing.data, missing.data);
  assert.equal(existing.status, missing.status);
  await f.server.security.drainMail();
  assert.equal(f.emails.length, 2);
  const token = f.token('reset');
  assert.equal((await f.request('/api/auth/reset-password', { token: 'a'.repeat(64), password })).status, 400);
  assert.equal((await f.request('/api/auth/reset-password', { token, password: 'short' })).status, 400);
  const replacement = 'A different long password 43!';
  const results = await Promise.all([
    f.request('/api/auth/reset-password', { token, password: replacement }),
    f.request('/api/auth/reset-password', { token, password: replacement })
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 400]);
  assert.equal((await f.request('/api/session', undefined, f.session)).data.user, null);
  assert.equal((await f.request('/api/auth/login', { email: 'test@example.com', password })).status, 401);
  assert.equal((await f.request('/api/auth/login', { email: 'test@example.com', password: replacement })).status, 200);
  assert.equal((await f.server.store.find('settings', { kind: 'email-token' })).length, 0);
});

test('resend uses a cooldown and replaces older links; expired links cannot change an account', async t => {
  const f = await fixture(t);
  const old = f.token('verify');
  assert.equal((await f.request('/api/auth/resend-verification', {}, f.session)).status, 200);
  await f.server.security.drainMail();
  assert.equal(f.emails.length, 1);
  f.advance(61000);
  await f.request('/api/auth/resend-verification', {}, f.session);
  await f.server.security.drainMail();
  assert.equal(f.emails.length, 2);
  assert.equal((await f.request('/api/auth/verify-email', { token: old })).status, 400);
  f.advance(24 * 60 * 60000 + 1);
  assert.equal((await f.request('/api/auth/verify-email', { token: f.token('verify') })).status, 400);
  assert.equal((await f.server.store.one('users', { email: 'test@example.com' })).emailVerified, false);
});

test('reset expires after 30 minutes and disabled accounts cannot use reset links', async t => {
  const f = await fixture(t);
  await f.request('/api/auth/forgot-password', { email: 'test@example.com' });
  await f.server.security.drainMail();
  const expired = f.token('reset');
  f.advance(30 * 60000 + 1);
  assert.equal((await f.request('/api/auth/reset-password', { token: expired, password })).status, 400);
  await f.request('/api/auth/forgot-password', { email: 'test@example.com' });
  await f.server.security.drainMail();
  const current = f.token('reset');
  const user = await f.server.store.one('users', { email: 'test@example.com' });
  await f.server.store.update('users', user._id, { active: false });
  assert.equal((await f.request('/api/auth/reset-password', { token: current, password })).status, 400);
});

test('email failures leave the account usable for retry and tokens are not exposed to clients', async t => {
  const f = await fixture(t);
  f.server.security.mailer.send = async () => { throw new Error('SMTP failure with secret details'); };
  const response = await f.request('/api/auth/forgot-password', { email: 'test@example.com' });
  assert.equal(response.status, 200);
  assert.equal(JSON.stringify(response.data).includes('token'), false);
  await f.server.security.drainMail();
  assert.equal(await f.server.store.one('settings', { purpose: 'reset' }), null);
  const logs = await f.server.store.find('account_logs', { action: 'email_delivery' });
  assert.equal(logs.length, 1);
  assert.equal(JSON.stringify(logs).includes('secret details'), false);
  assert.equal((await f.request('/api/auth/resend-verification', {}, { cookie: f.session.cookie })).status, 403);
  const crossSite = await fetch(`http://127.0.0.1:${f.server.address().port}/api/auth/forgot-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' }, body: JSON.stringify({ email: 'test@example.com' })
  });
  assert.equal(crossSite.status, 403);
  f.server.security.mailer.available = false;
  assert.equal((await f.request('/api/auth/forgot-password', { email: 'test@example.com' })).status, 503);
  assert.equal((await f.request('/api/auth/forgot-password', { email: 'missing@example.com' })).status, 503);
});

test('only users can run ciphers and only admins can access management endpoints', async t => {
  const f = await fixture(t);
  await f.server.security.bootstrap('Administrator', 'admin@example.com', password);
  const login = await f.request('/api/auth/login', { email: 'admin@example.com', password });
  assert.equal(login.status, 200);
  const admin = { cookie: login.cookie, csrfToken: login.data.csrfToken };
  const cipher = { cipher: 'caesar', mode: 'encrypt', text: 'hello', shift: 1 };
  assert.equal((await f.request('/api/cipher', cipher, admin)).status, 403);
  const dashboard = await f.request('/api/admin/dashboard', undefined, admin);
  assert.equal(dashboard.status, 200);
  assert.ok(Array.isArray(dashboard.data.recentActivity));
  assert.ok(dashboard.data.recentActivity.length > 0 && dashboard.data.recentActivity.length <= 8);
  assert.equal((await f.request('/api/admin/users', undefined, admin)).status, 200);
  await f.request('/api/auth/verify-email', { token: f.token('verify') }, f.session);
  assert.equal((await f.request('/api/cipher', cipher, f.session)).data.result, 'ifmmp');
  assert.equal((await f.request('/api/admin/dashboard', undefined, f.session)).status, 403);
  assert.equal((await f.request('/api/admin/users', undefined, f.session)).status, 403);
  assert.equal((await f.request('/api/admin/dashboard')).status, 401);
});
