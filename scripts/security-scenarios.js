'use strict';
const assert = require('node:assert/strict');
const DEMO_PASSWORD = 'Classroom demo passphrase 42!';
const ADMIN_EMAIL = 'admin@demo.example';

async function runScenarios(server) {
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(endpoint, { body, session, method } = {}) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (session) { headers.Cookie = session.cookie; headers['X-CSRF-Token'] = session.csrfToken; }
    const response = await fetch(base + endpoint, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined });
    const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
    return { status: response.status, data, retryAfter: response.headers.get('retry-after'), session: { cookie: response.headers.get('set-cookie')?.split(';')[0], csrfToken: data.csrfToken } };
  }
  async function createUser(name, email) {
    const created = await request('/api/auth/register', { body: { name, email, password: DEMO_PASSWORD } });
    assert.equal(created.status, 200);
    const user = await server.store.one('users', { email });
    // Only this isolated demo database is seeded as verified; production verification is unchanged.
    await server.store.update('users', user._id, { emailVerified: true });
    await server.security.drainMail();
    return { user, session: created.session };
  }
  await server.security.bootstrap('Demo Administrator', ADMIN_EMAIL, DEMO_PASSWORD);
  const adminLogin = await request('/api/auth/login', { body: { email: ADMIN_EMAIL, password: DEMO_PASSWORD } });
  assert.equal(adminLogin.status, 200);
  const admin = adminLogin.session;
  const normal = await createUser('Normal User', 'normal@demo.example');
  const scenarios = [];
  assert.equal((await request('/api/admin/users', { session: normal.session })).status, 403);
  assert.equal((await request('/api/admin/users', { session: admin })).status, 200);
  assert.equal((await request('/api/cipher', { session: admin, body: { cipher: 'caesar', mode: 'encrypt', text: 'CLASSROOM', shift: 3 } })).status, 403);
  scenarios.push({ scenario: 1, name: 'Authentication and role-based access', passed: true, evidence: 'Registration and login work; user management is admin-only and ciphers are user-only.' });

  const operation = { cipher: 'caesar', mode: 'encrypt', text: 'CLASSROOM', shift: 3 };
  const encrypted = await request('/api/cipher', { session: normal.session, body: operation });
  assert.equal(encrypted.status, 200);
  const decrypted = await request('/api/cipher', { session: normal.session, body: { ...operation, mode: 'decrypt', text: encrypted.data.result } });
  assert.equal(decrypted.data.result, operation.text);
  assert.equal((await request('/api/profile', { method: 'PATCH', session: normal.session, body: { name: 'Normal Demo User' } })).status, 200);
  assert.equal((await request('/api/auth/logout', { session: normal.session, body: {} })).status, 200);
  assert.equal((await request('/api/session', { session: normal.session })).data.user, null);
  const normalEvents = await server.store.find('activities', { actorId: normal.user._id });
  assert.ok(normalEvents.some(event => event.action === 'cipher' && event.outcome === 'success'));
  assert.ok(normalEvents.some(event => event.action === 'logout'));
  scenarios.push({ scenario: 2, name: 'Normal user activity', passed: true, evidence: 'Encrypt/decrypt, profile update and logout are recorded; logout invalidates the session.' });

  const locked = await createUser('Lockout User', 'lockout@demo.example');
  for (let attempt = 1; attempt <= 5; attempt++) {
    assert.equal((await request('/api/auth/login', { body: { email: locked.user.email, password: 'Incorrect demo password' } })).status, 401);
    const account = await server.store.one('users', { _id: locked.user._id });
    if (attempt < 5) assert.ok(!(account.lockedUntil > server.security.now()));
  }
  const lockedAccount = await server.store.one('users', { _id: locked.user._id });
  assert.ok(lockedAccount.lockedUntil > server.security.now());
  assert.equal(lockedAccount.failedLogins.length, 5);
  assert.equal((await request('/api/auth/login', { body: { email: locked.user.email, password: DEMO_PASSWORD } })).status, 401);
  assert.equal((await request('/api/session', { session: locked.session })).data.user, null);
  assert.ok(await server.store.one('alerts', { action: 'account_locked' }));
  scenarios.push({ scenario: 3, name: 'Five failed login attempts', passed: true, evidence: 'Exactly five failed attempts lock the account for 15 minutes, revoke sessions and alert the administrator.' });

  const suspicious = await createUser('Suspicious User', 'suspicious@demo.example');
  for (let attempt = 0; attempt < 3; attempt++) await request('/api/auth/login', { body: { email: suspicious.user.email, password: 'Incorrect demo password' } });
  for (let attempt = 0; attempt < 2; attempt++) assert.equal((await request('/api/admin/users', { session: suspicious.session })).status, 403);
  for (let change = 0; change < 3; change++) assert.equal((await request('/api/profile', { method: 'PATCH', session: suspicious.session, body: { name: `Suspicious Demo User ${change + 1}` } })).status, 200);
  const anomaly = await server.store.one('security_events', { action: 'ai_anomaly', actorId: suspicious.user._id });
  assert.ok(anomaly?.assessment.anomalous);
  assert.ok(anomaly.assessment.score > server.security.monitor.metadata.threshold);
  const restriction = await server.store.one('alerts', { action: 'ai_restriction', actorId: suspicious.user._id });
  assert.ok(restriction);
  const blocked = await request('/api/cipher', { session: suspicious.session, body: operation });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.retryAfter) > 0);
  scenarios.push({ scenario: 4, name: 'AI detection and prevention', passed: true, evidence: 'The real Isolation Forest detects a mixed pattern of failed logins, denied access and account changes; cipher access is paused for one minute.', assessment: anomaly.assessment });

  const dashboard = await request('/api/admin/dashboard', { session: admin });
  assert.ok(dashboard.data.summary.openAlerts > 0);
  assert.ok(dashboard.data.summary.anomalies > 0);
  const exportResult = await request('/api/admin/logs?type=activity&export=csv', { session: admin });
  assert.equal(exportResult.status, 200);
  assert.match(exportResult.data, /createdAt,actorName,action,outcome/);
  const activities = await server.store.find('activities');
  const accountLogs = await server.store.find('account_logs');
  assert.ok(accountLogs.some(event => event.action === 'profile_updated'));
  assert.ok(accountLogs.some(event => event.action === 'account_locked'));
  assert.equal(JSON.stringify([...activities, ...accountLogs]).includes(DEMO_PASSWORD), false);
  assert.equal(JSON.stringify(activities).includes(operation.text), false);
  const report = { generatedAt: new Date().toISOString(), database: 'Isolated in-memory SQLite; no Supabase data modified', model: server.security.monitor.metadata, scenarios, summary: dashboard.data.summary };
  return { report, admin, request, suspicious, normal, locked };
}
module.exports = { runScenarios, DEMO_PASSWORD, ADMIN_EMAIL };
