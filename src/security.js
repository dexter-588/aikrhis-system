'use strict';
const { randomBytes, createHash, randomUUID } = require('node:crypto');
const { hashPassword, verifyPassword, validatePassword } = require('./passwords');
const { createMonitor } = require('./isolation-forest');
const Ciphers = require('../public/cipher');
const { createMailer } = require('./mailer');
const MINUTE = 60000;
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const publicUser = user => user ? ({ id: user._id, name: user.name, email: user.email, role: user.role, active: user.active, emailVerified: user.emailVerified === true, lockedUntil: user.lockedUntil || null, cipherRestrictedUntil: user.cipherRestrictedUntil || null, createdAt: user.createdAt }) : null;
function emailAddress(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) fail(400, 'Enter a valid email address.');
  return value.trim().toLowerCase();
}
function identity(body) {
  if (typeof body.name !== 'string' || body.name.trim().length < 2 || body.name.trim().length > 60) fail(400, 'Name must contain 2 to 60 characters.');
  if (typeof body.email !== 'string' || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) fail(400, 'Enter a valid email address.');
  return { name: body.name.trim(), email: body.email.trim().toLowerCase() };
}
function csv(rows) {
  const fields = ['createdAt', 'actorName', 'action', 'outcome', 'targetId', 'severity', 'message'];
  const escape = value => '"' + String(value ?? '').replace(/^[=+@\-\t\r]/, "'$&").replace(/"/g, '""') + '"';
  return [fields.join(','), ...rows.map(row => fields.map(key => escape(row[key])).join(','))].join('\r\n');
}

class SecurityService {
  constructor(store, options = {}) {
    this.store = store;
    this.now = options.now || Date.now;
    this.monitor = options.monitor || createMonitor();
    this.secureCookies = options.secureCookies || false;
    this.origin = options.origin;
    this.linkOrigin = options.origin || 'http://localhost:3000';
    const linkUrl = new URL(this.linkOrigin);
    if (!['http:', 'https:'].includes(linkUrl.protocol) || linkUrl.username || linkUrl.password || linkUrl.pathname !== '/' || linkUrl.search || linkUrl.hash || (this.secureCookies && linkUrl.protocol !== 'https:')) throw new Error('PUBLIC_ORIGIN must be the application origin (HTTPS in production).');
    this.mailer = options.mailer || createMailer(options.mail);
    this.pendingMail = new Set();
    this.queue = Promise.resolve();
    this.rates = new Map();
    this.lockThreshold = options.lockThreshold || 5;
    this.idleTimeout = 30 * MINUTE;
  }
  run(task) {
    const result = this.queue.then(task);
    this.queue = result.catch(() => {});
    return result;
  }
  stamp() { return new Date(this.now()).toISOString(); }
  queueAccountEmail(req, user, purpose) {
    if (!user || !user.active || !this.mailer.available) return;
    const audit = { user, socket: { remoteAddress: req.socket?.remoteAddress }, requestId: req.requestId };
    const task = this.run(async () => {
      const current = await this.store.one('users', { _id: user._id });
      if (!current?.active || (purpose === 'verify' && current.emailVerified)) return;
      const id = `email-token:${purpose}:${current._id}`;
      const previous = await this.store.one('settings', { _id: id });
      if (previous && previous.createdAtMs + MINUTE > this.now()) return;
      const token = randomBytes(32).toString('hex');
      const ttl = purpose === 'reset' ? 30 * MINUTE : 24 * 60 * MINUTE;
      await this.store.remove('settings', { _id: id });
      await this.store.insert('settings', { _id: id, kind: 'email-token', purpose, userId: current._id, email: current.email, authVersion: current.authVersion, tokenHash: sha(token), expiresAt: this.now() + ttl, createdAtMs: this.now() });
      const link = new URL('/', this.linkOrigin);
      link.hash = `${purpose === 'reset' ? 'reset-password' : 'verify-email'}=${token}`;
      try {
        await this.mailer.send({ to: current.email,
          subject: purpose === 'reset' ? 'Reset your Aikrhis password' : 'Verify your Aikrhis email',
          text: `${purpose === 'reset' ? 'Choose a new password' : 'Confirm your email address'} by opening this link:\n\n${link.toString()}\n\nThis link expires in ${purpose === 'reset' ? '30 minutes' : '24 hours'} and can be used once. If you did not request it, you can ignore this message.` });
        await this.log('account_logs', audit, purpose === 'reset' ? 'password_reset_email' : 'verification_email', 'success', { targetId: current._id });
      } catch {
        await this.store.remove('settings', { _id: id, tokenHash: sha(token) });
        await this.log('account_logs', audit, 'email_delivery', 'failure', { targetId: current._id, purpose });
      }
    }).catch(error => console.error('Account email job failed:', error.code || error.name));
    this.pendingMail.add(task);
    task.finally(() => this.pendingMail.delete(task));
  }
  async drainMail() { await Promise.all([...this.pendingMail]); }
  async consumeEmailToken(token, purpose) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) fail(400, 'This link is invalid or expired. Request a new link.');
    const filter = { kind: 'email-token', purpose, tokenHash: sha(token) };
    const entry = await this.store.one('settings', filter);
    const user = entry && await this.store.one('users', { _id: entry.userId });
    if (!entry || entry.expiresAt <= this.now() || !user?.active || entry.email !== user.email || entry.authVersion !== user.authVersion) fail(400, 'This link is invalid or expired. Request a new link.');
    if (!await this.store.take('settings', { ...filter, _id: entry._id })) fail(400, 'This link is invalid or expired. Request a new link.');
    return user;
  }
  async log(collection, req, action, outcome, details = {}) {
    return this.store.insert(collection, { createdAt: this.stamp(), actorId: req.user?._id || null, actorName: req.user?.name || 'Guest', source: req.socket?.remoteAddress || 'setup', requestId: req.requestId || randomUUID(), action, outcome, ...details });
  }
  async alert(req, action, message, severity = 'high', details = {}) {
    const event = await this.log('security_events', req, action, 'detected', { message, severity, ...details });
    const dedupeKey = `${req.user?._id || req.socket?.remoteAddress || 'system'}:${action}`;
    const previous = await this.store.one('alerts', { dedupeKey, status: 'open', createdAt: { $gte: new Date(this.now() - 5 * MINUTE).toISOString() } });
    if (!previous) await this.store.insert('alerts', { ...event, _id: randomUUID(), eventId: event._id, dedupeKey, status: 'open' });
  }
  async assess(req) {
    try {
      const filter = { createdAt: { $gte: new Date(this.now() - 15 * MINUTE).toISOString() } };
      if (req.user) filter.actorId = req.user._id;
      else filter.source = req.socket?.remoteAddress || 'setup';
      const rows = await this.store.find('activities', filter);
      const accountRows = req.user ? await this.store.find('account_logs', filter) : [];
      const features = {
        failedLogins15m: rows.filter(row => row.action === 'login' && row.outcome === 'failure').length,
        deniedAccess15m: rows.filter(row => row.outcome === 'denied').length,
        cipherRequests1m: rows.filter(row => row.action === 'cipher' && Date.parse(row.createdAt) >= this.now() - MINUTE).length,
        accountChanges15m: accountRows.filter(row => ['account_created', 'profile_updated', 'password_changed', 'password_reset', 'email_verified', 'role_changed', 'account_activated', 'account_deactivated', 'account_unlocked'].includes(row.action)).length
      };
      const assessment = this.monitor.assess(features);
      if (assessment.anomalous) await this.alert(req, 'ai_anomaly', 'Activity differs from the synthetic baseline. Review the observed counts; this is not proof of an attack.', 'medium', { assessment });
      const corroborated = features.failedLogins15m >= 3 || features.deniedAccess15m >= 2 || features.accountChanges15m >= 5;
      if (assessment.anomalous && corroborated && req.user?.role === 'user' && !(req.user.cipherRestrictedUntil > this.now()) && !(req.user.aiRestrictionCooldownUntil > this.now())) {
        const until = this.now() + MINUTE;
        req.user = await this.store.update('users', req.user._id, { cipherRestrictedUntil: until, aiRestrictionCooldownUntil: this.now() + 15 * MINUTE });
        await this.log('account_logs', req, 'cipher_access_restricted', 'restricted', { targetId: req.user._id, restrictedUntil: until });
        await this.alert(req, 'ai_restriction', 'Cipher operations were paused for one minute after an anomalous pattern with repeated security events. Review the assessment before taking further action.', 'high', { assessment, restrictedUntil: until });
      }
      return assessment;
    } catch {
      await this.alert(req, 'monitor_unavailable', 'AI monitoring is unavailable. Login restrictions and access controls remain active.', 'high');
      return null;
    }
  }
  rate(req, group, limit, window) {
    const time = this.now();
    for (const [key, entry] of this.rates) if (entry.reset <= time) this.rates.delete(key);
    const key = `${req.socket.remoteAddress}:${group}`;
    const entry = this.rates.get(key) || { count: 0, reset: time + window };
    entry.count += 1;
    this.rates.set(key, entry);
    return entry.count > limit;
  }
  cookie(res, token, remember = false, clear = false) {
    res.setHeader('Set-Cookie', `aikrhis_session=${token}; Path=/; HttpOnly; SameSite=Strict${this.secureCookies ? '; Secure' : ''}${clear ? '; Max-Age=0' : remember ? '; Max-Age=604800' : ''}`);
  }
  async session(req) {
    const token = /(?:^|;\s*)aikrhis_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    if (!token) return null;
    const session = await this.store.one('sessions', { _id: sha(token) });
    if (!session) return null;
    const user = await this.store.one('users', { _id: session.userId });
    if (session.expiresAt <= this.now() || session.lastSeen + this.idleTimeout <= this.now() || !user?.active || (user.lockedUntil || 0) > this.now() || session.authVersion !== user.authVersion) {
      await this.store.remove('sessions', { _id: session._id });
      return null;
    }
    req.user = user;
    req.session = session;
    await this.store.update('sessions', session._id, { lastSeen: this.now() });
    return user;
  }
  async startSession(req, res, user, remember = false) {
    if (req.session) await this.store.remove('sessions', { _id: req.session._id });
    const token = randomBytes(32).toString('hex');
    const csrfToken = randomBytes(32).toString('hex');
    const expiresAt = this.now() + (remember ? 7 * 24 * 60 : 8 * 60) * MINUTE;
    await this.store.insert('sessions', { _id: sha(token), userId: user._id, csrfToken, expiresAt, expiresAtDate: new Date(expiresAt), lastSeen: this.now(), authVersion: user.authVersion });
    this.cookie(res, token, remember);
    return { user: publicUser(user), csrfToken };
  }
  async denied(req, status, message) {
    await this.log('activities', req, 'access', 'denied', { resource: req.path });
    await this.alert(req, 'access_denied', 'An attempt to access a restricted function was blocked.', 'medium', { resource: req.path });
    await this.assess(req);
    fail(status, message);
  }
  async bootstrap(name, email, password) {
    const fields = identity({ name, email });
    validatePassword(password);
    if (await this.store.one('users', { role: 'admin' })) fail(409, 'An administrator already exists. Use account management.');
    // A unique reservation prevents two concurrent setup commands from creating initial admins.
    const passwordHash = await hashPassword(password);
    await this.store.insert('settings', { _id: 'admin-bootstrap', createdAt: this.stamp() });
    try {
      const user = await this.store.insert('users', { ...fields, passwordHash, role: 'admin', active: true, emailVerified: true, authVersion: 1, failedLogins: [], createdAt: this.stamp() });
      await this.log('account_logs', { user }, 'account_created', 'success', { targetId: user._id, role: 'admin', via: 'setup' });
      return publicUser(user);
    } catch (error) { await this.store.remove('settings', { _id: 'admin-bootstrap' }); throw error; }
  }
  async handle(req, res) {
    req.requestId = randomUUID();
    res.setHeader('X-Request-ID', req.requestId);
    const body = req.body || {};
    if (this.rate(req, 'api', 240, MINUTE)) {
      res.setHeader('Retry-After', '60');
      await this.log('activities', req, 'rate_limit', 'denied');
      await this.alert(req, 'rate_limit', 'Request limit exceeded. Requests temporarily blocked.');
      fail(429, 'Too many requests. Wait a minute.');
    }
    await this.session(req);
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (!req.is('application/json')) fail(415, 'Send application/json.');
      const origin = req.headers.origin;
      if ((origin && origin !== (this.origin || `${req.protocol}://${req.headers.host}`)) || req.headers['sec-fetch-site'] === 'cross-site') {
        return this.denied(req, 403, 'Cross-site request blocked.');
      }
      if (req.session && req.headers['x-csrf-token'] !== req.session.csrfToken) return this.denied(req, 403, 'Invalid security token. Refresh the page.');
    }
    if (req.path === '/api/session' && req.method === 'GET') return { user: publicUser(req.user), csrfToken: req.session?.csrfToken || null };
    if (['/api/auth/forgot-password', '/api/auth/reset-password', '/api/auth/verify-email'].includes(req.path) && req.method === 'POST') {
      if (this.rate(req, 'recovery', 10, 15 * MINUTE)) fail(429, 'Too many attempts. Try again later.');
      if (req.path.endsWith('/forgot-password')) {
        const email = emailAddress(body.email);
        if (!this.mailer.available) fail(503, 'Email delivery is temporarily unavailable. Try again later.');
        const user = await this.store.one('users', { email });
        this.queueAccountEmail(req, user, 'reset');
        return { success: true, message: 'If an active account uses this email, a password reset link will be sent. Check your inbox and spam folder.' };
      }
      if (req.path.endsWith('/reset-password')) {
        validatePassword(body.password);
        const passwordHash = await hashPassword(body.password);
        const user = await this.consumeEmailToken(body.token, 'reset');
        await this.store.update('users', user._id, { passwordHash, authVersion: user.authVersion + 1, failedLogins: [], lockedUntil: 0 });
        await this.store.remove('sessions', { userId: user._id });
        await this.store.remove('settings', { kind: 'email-token', userId: user._id });
        req.user = user;
        await this.log('account_logs', req, 'password_reset', 'success', { targetId: user._id });
        if (req.session?.userId === user._id) this.cookie(res, '', false, true);
        return { success: true, message: 'Password reset. Sign in with your new password.' };
      }
      const user = await this.consumeEmailToken(body.token, 'verify');
      await this.store.update('users', user._id, { emailVerified: true, emailVerifiedAt: this.stamp() });
      req.user = user;
      await this.log('account_logs', req, 'email_verified', 'success', { targetId: user._id });
      return { success: true, message: 'Email verified. You can now use cipher operations.' };
    }
    if (['/api/auth/login', '/api/auth/register'].includes(req.path) && req.method === 'POST') {
      if (this.rate(req, 'auth', 30, 15 * MINUTE)) {
        await this.log('activities', req, 'login', 'denied');
        await this.alert(req, 'auth_throttled', 'Repeated authentication requests were throttled.');
        res.setHeader('Retry-After', '900');
        fail(429, 'Too many authentication attempts. Try again later.');
      }
      if (req.path.endsWith('/register')) {
        const fields = identity(body);
        validatePassword(body.password);
        if (await this.store.one('users', { email: fields.email })) fail(409, 'Registration unavailable for this email. Try signing in.');
        const user = await this.store.insert('users', { ...fields, passwordHash: await hashPassword(body.password), role: 'user', active: true, emailVerified: false, authVersion: 1, failedLogins: [], createdAt: this.stamp() });
        req.user = user;
        await this.log('account_logs', req, 'account_created', 'success', { targetId: user._id, role: 'user' });
        await this.log('activities', req, 'login', 'success');
        this.queueAccountEmail(req, user, 'verify');
        return { ...await this.startSession(req, res, user), message: 'Account created. Verify your email to use cipher operations.', emailDeliveryAvailable: this.mailer.available };
      }
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 254) : '';
      const user = await this.store.one('users', { email });
      req.user = user || null;
      if (user && (!user.active || (user.lockedUntil || 0) > this.now())) {
        await this.log('activities', req, 'login', 'denied');
        fail(401, 'Login unavailable. Check your credentials or try again later.');
      }
      // Unknown users run the same expensive KDF to reduce account enumeration by timing.
      const dummy = 'scrypt$00000000000000000000000000000000$' + '0'.repeat(128);
      if (!await verifyPassword(body.password, user?.passwordHash || dummy) || !user) {
        if (user) {
          const failures = (user.failedLogins || []).filter(time => time > this.now() - 15 * MINUTE).concat(this.now());
          const lockedUntil = failures.length >= this.lockThreshold ? this.now() + 15 * MINUTE : 0;
          await this.store.update('users', user._id, { failedLogins: failures, lockedUntil });
          if (lockedUntil) {
            await this.store.remove('sessions', { userId: user._id });
            await this.log('account_logs', req, 'account_locked', 'restricted', { targetId: user._id, lockedUntil });
            await this.alert(req, 'account_locked', 'Repeated failed logins triggered a 15-minute account lock.');
          }
        }
        await this.log('activities', req, 'login', 'failure');
        await this.assess(req);
        fail(401, 'Login unavailable. Check your credentials or try again later.');
      }
      const updated = await this.store.update('users', user._id, { failedLogins: [], lockedUntil: 0 });
      req.user = updated;
      await this.log('activities', req, 'login', 'success');
      await this.assess(req);
      return this.startSession(req, res, req.user, body.remember === true);
    }
    if (!req.user) return this.denied(req, 401, 'Sign in to continue.');
    if (req.path === '/api/auth/resend-verification' && req.method === 'POST') {
      if (req.user.emailVerified) return { success: true, message: 'Your email is already verified.' };
      if (this.rate(req, 'verification', 5, 15 * MINUTE)) fail(429, 'Too many requests. Try again later.');
      if (!this.mailer.available) fail(503, 'Email delivery is temporarily unavailable. Try again later.');
      this.queueAccountEmail(req, req.user, 'verify');
      return { success: true, message: 'A verification link will be sent to your email. Check your inbox and spam folder; allow a minute before requesting another.' };
    }
    if (req.path.startsWith('/api/admin/') && req.user.role !== 'admin') return this.denied(req, 403, 'Administrator access required.');
    if (req.path === '/api/auth/logout' && req.method === 'POST') {
      await this.log('activities', req, 'logout', 'success');
      await this.store.remove('sessions', { _id: req.session._id });
      this.cookie(res, '', false, true);
      return { success: true };
    }
    if (req.path === '/api/profile' && req.method === 'PATCH') {
      if (typeof body.name !== 'string' || body.name.trim().length < 2 || body.name.trim().length > 60) fail(400, 'Name must contain 2 to 60 characters.');
      const user = await this.store.update('users', req.user._id, { name: body.name.trim() });
      await this.log('account_logs', req, 'profile_updated', 'success', { targetId: user._id });
      await this.assess(req);
      return { user: publicUser(user) };
    }
    if (req.path === '/api/password' && req.method === 'POST') {
      if (this.rate(req, 'password', 5, 15 * MINUTE)) fail(429, 'Too many password change attempts. Try again later.');
      if (!await verifyPassword(body.currentPassword, req.user.passwordHash)) {
        await this.log('activities', req, 'password_change', 'denied');
        fail(400, 'Current password is incorrect.');
      }
      const passwordHash = await hashPassword(body.newPassword);
      await this.store.update('users', req.user._id, { passwordHash, authVersion: req.user.authVersion + 1 });
      await this.store.remove('sessions', { userId: req.user._id });
      await this.log('account_logs', req, 'password_changed', 'success', { targetId: req.user._id });
      this.cookie(res, '', false, true);
      return { success: true, message: 'Password changed. Sign in again.' };
    }
    if (req.path === '/api/cipher' && req.method === 'POST') {
      if (req.user.role !== 'user') return this.denied(req, 403, 'The cipher workspace is available to user accounts only. Use the administrator dashboard to manage the system.');
      if (req.user.cipherRestrictedUntil > this.now()) {
        res.setHeader('Retry-After', String(Math.ceil((req.user.cipherRestrictedUntil - this.now()) / 1000)));
        await this.log('activities', req, 'cipher', 'denied', { restriction: 'ai_review' });
        fail(429, 'Cipher access is temporarily paused after unusual activity. Wait one minute or ask an administrator to review your account.');
      }
      if (!req.user.emailVerified) fail(403, 'Verify your email before running cipher operations. Use Send verification email on the home page.');
      if (!['caesar', 'playfair', 'vigenere', 'bifid'].includes(body.cipher) || !['encrypt', 'decrypt'].includes(body.mode) || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 5000) fail(400, 'Choose a valid cipher, operation, and message (maximum 5,000 characters).');
      if (this.rate(req, `cipher:${req.user._id}`, 60, MINUTE)) {
        await this.log('activities', req, 'cipher', 'denied');
        await this.alert(req, 'cipher_restricted', 'Cipher request limit exceeded. Operations restricted for one minute.');
        fail(429, 'Cipher limit reached. Wait one minute.');
      }
      let result;
      try {
        if (body.cipher === 'caesar') {
          if (!Number.isInteger(body.shift) || body.shift < 1 || body.shift > 25) fail(400, 'Shift must be an integer from 1 to 25.');
        } else if (typeof body.key !== 'string' || body.key.length > 50 || !/^[a-z]+$/i.test(body.key)) fail(400, 'Enter a key with 1 to 50 letters.');
        if (body.cipher === 'bifid' && (!Number.isInteger(body.period) || body.period < 1 || body.period > 50)) fail(400, 'Bifid period must be an integer from 1 to 50.');
        const fn = Ciphers[body.cipher + (body.mode === 'encrypt' ? 'Encrypt' : 'Decrypt')];
        result = fn(body.text, body.cipher === 'caesar' ? body.shift : body.key, body.period);
      } catch (error) {
        await this.log('activities', req, 'cipher', 'failure', { cipher: body.cipher, operation: body.mode, inputLength: body.text.length });
        fail(400, error.message);
      }
      await this.log('activities', req, 'cipher', 'success', { cipher: body.cipher, operation: body.mode, inputLength: body.text.length });
      await this.assess(req);
      return { result, cipherRestrictedUntil: req.user.cipherRestrictedUntil || null };
    }
    if (req.path === '/api/activity' && req.method === 'GET') return { rows: await this.store.find('activities', { actorId: req.user._id }, { sort: { createdAt: -1 }, limit: 100 }) };
    if (req.path === '/api/admin/users' && req.method === 'GET') return { users: (await this.store.find('users', {}, { limit: 1000 })).map(publicUser) };
    if (/^\/api\/admin\/users\/[^/]+$/.test(req.path) && req.method === 'PATCH') {
      const target = await this.store.one('users', { _id: req.path.split('/').at(-1) });
      if (!target) fail(404, 'Account not found.');
      if (target._id === req.user._id) fail(400, 'Use your profile to edit yourself. An administrator cannot restrict their own account.');
      const patch = {};
      const changes = [];
      if (body.role !== undefined) { if (!['user', 'admin'].includes(body.role)) fail(400, 'Invalid role.'); if (body.role !== target.role) { patch.role = body.role; changes.push(['role_changed', { previous: target.role, next: body.role }]); } }
      if (body.active !== undefined) { if (typeof body.active !== 'boolean') fail(400, 'Invalid account status.'); if (body.active !== target.active) { patch.active = body.active; changes.push([body.active ? 'account_activated' : 'account_deactivated', {}]); } }
      if (body.unlock === true) { patch.lockedUntil = 0; patch.failedLogins = []; patch.cipherRestrictedUntil = 0; changes.push(['account_unlocked', {}]); }
      if (!changes.length) fail(400, 'No account changes supplied.');
      patch.authVersion = target.authVersion + 1;
      const user = await this.store.update('users', target._id, patch);
      await this.store.remove('sessions', { userId: target._id });
      for (const [action, details] of changes) await this.log('account_logs', req, action, 'success', { targetId: target._id, ...details });
      await this.assess(req);
      return { user: publicUser(user) };
    }
    if (req.path === '/api/admin/dashboard' && req.method === 'GET') {
      const [users, events, alerts, activities] = await Promise.all(['users', 'security_events', 'alerts', 'activities'].map(name => this.store.find(name, {}, { sort: { createdAt: -1 }, limit: 10000 })));
      return { summary: { users: users.length, activeUsers: users.filter(user => user.active).length, lockedAccounts: users.filter(user => user.lockedUntil > this.now()).length, openAlerts: alerts.filter(alert => alert.status === 'open').length, failedLogins: activities.filter(row => row.action === 'login' && row.outcome === 'failure').length, anomalies: events.filter(row => row.action === 'ai_anomaly').length }, monitor: this.monitor.metadata || { algorithm: 'Unavailable' }, storage: this.store.kind, recentActivity: activities.slice(0, 8), alerts: alerts.slice(0, 50), events: events.slice(0, 50) };
    }
    if (req.path === '/api/admin/logs' && req.method === 'GET') {
      const collection = { activity: 'activities', accounts: 'account_logs', security: 'security_events', alerts: 'alerts' }[req.query.type || 'activity'];
      if (!collection) fail(400, 'Invalid log type.');
      const filter = {};
      if (req.query.user) filter.actorId = String(req.query.user).slice(0, 100);
      if (req.query.action) filter.action = String(req.query.action).slice(0, 60);
      if (req.query.from) { const date = new Date(String(req.query.from)); if (Number.isNaN(date.getTime())) fail(400, 'Invalid start date.'); filter.createdAt = { $gte: date.toISOString() }; }
      const page = Math.min(10000, Math.max(1, parseInt(req.query.page, 10) || 1));
      const rows = await this.store.find(collection, filter, { sort: { createdAt: -1 }, skip: req.query.export === 'csv' ? 0 : (page - 1) * 50, limit: req.query.export === 'csv' ? 5000 : 51 });
      if (req.query.export === 'csv') {
        await this.log('activities', req, 'report_exported', 'success', { report: req.query.type || 'activity', rowCount: rows.length });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="aikrhis-security-report.csv"');
        res.send(csv(rows));
        return undefined;
      }
      return { rows: rows.slice(0, 50), hasMore: rows.length > 50, page };
    }
    if (/^\/api\/admin\/alerts\/[^/]+$/.test(req.path) && req.method === 'PATCH') {
      if (!['acknowledged', 'resolved'].includes(body.status)) fail(400, 'Invalid alert status.');
      const id = req.path.split('/').at(-1);
      const alert = await this.store.update('alerts', id, { status: body.status, reviewedBy: req.user._id, reviewedAt: this.stamp() });
      if (!alert) fail(404, 'Alert not found.');
      await this.log('activities', req, 'alert_reviewed', 'success', { targetId: id, status: body.status });
      return { alert };
    }
    fail(404, 'API endpoint not found.');
  }
}
module.exports = { SecurityService, publicUser, csv };
