const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../app');
const { runScenarios } = require('../scripts/security-scenarios');
const { DEMO_PASSWORD } = require('../scripts/security-scenarios');

test('all four final demonstration scenarios run through real endpoints and the actual ML model', async () => {
  let clock = Date.now();
  const server = createServer({ storage: 'sqlite', dbPath: ':memory:', origin: undefined, now: () => clock, mailer: { available: false } });
  await server.ready;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await runScenarios(server);
    assert.equal(result.report.scenarios.length, 4);
    assert.ok(result.report.scenarios.every(scenario => scenario.passed));
    // The temporary AI restriction expires, while reviewable evidence stays in the logs.
    clock += 61000;
    const resumed = await result.request('/api/cipher', { session: result.suspicious.session, body: { cipher: 'caesar', mode: 'encrypt', text: 'TEST', shift: 1 } });
    assert.equal(resumed.status, 200);
    assert.ok(!(resumed.data.cipherRestrictedUntil > clock));
    assert.ok(await server.store.one('security_events', { action: 'ai_restriction' }));
    // Administrators can clear a five-attempt lock through the normal management API.
    const unlocked = await result.request(`/api/admin/users/${result.locked.user._id}`, { method: 'PATCH', session: result.admin, body: { unlock: true } });
    assert.equal(unlocked.status, 200);
    assert.equal((await server.store.one('users', { _id: result.locked.user._id })).lockedUntil, 0);
    const signedIn = await result.request('/api/auth/login', { body: { email: result.normal.user.email, password: DEMO_PASSWORD } });
    assert.equal(signedIn.status, 200);
    const normalId = result.normal.user._id;
    assert.equal((await result.request(`/api/admin/users/${normalId}`, { method: 'PATCH', session: result.admin, body: { role: 'admin' } })).status, 200);
    assert.equal((await result.request('/api/session', { session: signedIn.session })).data.user, null);
    assert.equal((await result.request(`/api/admin/users/${normalId}`, { method: 'PATCH', session: result.admin, body: { active: false } })).status, 200);
    assert.equal((await result.request('/api/auth/login', { body: { email: result.normal.user.email, password: DEMO_PASSWORD } })).status, 401);
    assert.equal((await result.request(`/api/admin/users/${normalId}`, { method: 'PATCH', session: result.admin, body: { role: 'user', active: true } })).status, 200);
    const reactivated = await result.request('/api/auth/login', { body: { email: result.normal.user.email, password: DEMO_PASSWORD } });
    const replacement = 'Changed classroom password 99!';
    assert.equal((await result.request('/api/password', { session: reactivated.session, body: { currentPassword: DEMO_PASSWORD, newPassword: replacement } })).status, 200);
    assert.equal((await result.request('/api/session', { session: reactivated.session })).data.user, null);
    assert.equal((await result.request('/api/auth/login', { body: { email: result.normal.user.email, password: DEMO_PASSWORD } })).status, 401);
    assert.equal((await result.request('/api/auth/login', { body: { email: result.normal.user.email, password: replacement } })).status, 200);
    const audit = await server.store.find('account_logs', { targetId: normalId });
    for (const action of ['account_created', 'profile_updated', 'role_changed', 'account_deactivated', 'account_activated', 'password_changed']) assert.ok(audit.some(event => event.action === action));
    assert.equal(JSON.stringify(audit).includes(replacement), false);
  } finally { await server.security.drainMail(); await new Promise(resolve => server.close(resolve)); await server.store.close(); }
});
