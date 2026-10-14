'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { PGlite } = require('@electric-sql/pglite');
const { createStore } = require('../src/store');

test('PostgreSQL storage runs account and session operations against PostgreSQL', async t => {
  const db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
  // Only replace transport. PostgreSQL itself executes all schema and store SQL.
  t.mock.method(Pool.prototype, 'query', (sql, values) => db.query(sql, values));
  t.mock.method(Pool.prototype, 'end', async () => {});
  let store;
  try {
    store = await createStore({ storage: 'postgres', postgresUrl: 'postgresql://postgres:test@localhost/postgres' });
    assert.equal(store.kind, 'postgres');
    const first = await store.insert('users', { email: 'first@example.com', active: true, createdAt: '2026-01-01', attempts: 2 });
    const second = await store.insert('users', { email: 'second@example.com', active: false, createdAt: '2026-02-01', attempts: 10 });
    assert.equal((await store.one('users', { email: first.email }))._id, first._id);
    await assert.rejects(store.insert('users', { email: first.email }), { code: '23505' });
    await assert.rejects(store.insert('users', { _id: first._id, email: 'third@example.com' }), { code: '23505' });
    assert.deepEqual((await store.find('users', { active: true })).map(row => row._id), [first._id]);
    assert.deepEqual((await store.find('users', { attempts: { $gte: 5 } })).map(row => row._id), [second._id]);
    assert.deepEqual((await store.find('users', { createdAt: { $gte: '2026-02-01' } })).map(row => row._id), [second._id]);
    assert.equal((await store.find('users', { email: { $in: [first.email, second.email] } })).length, 2);
    assert.deepEqual(await store.find('users', { email: { $in: [] } }), []);
    assert.equal((await store.find('users', {}, { sort: { attempts: -1 }, limit: 1 }))[0]._id, second._id);
    assert.equal((await store.find('users', {}, { sort: { createdAt: 1 }, skip: 1, limit: 1 }))[0]._id, second._id);
    assert.deepEqual(await store.find('users', {}, { limit: 0 }), []);
    assert.deepEqual(await store.find('users', { "email') OR TRUE --": first.email }), []);
    const updated = await store.update('users', first._id, { name: 'Changed', _id: 'cannot-change-id' });
    assert.equal(updated._id, first._id);
    assert.equal(updated.email, first.email);
    assert.equal(updated.name, 'Changed');
    await assert.rejects(store.update('users', first._id, { email: second.email }), { code: '23505' });
    assert.equal(await store.update('users', 'missing', {}), null);
    await store.insert('sessions', { _id: 'session', userId: first._id, expiresAt: Date.now() + 60000 });
    await store.remove('sessions', { userId: first._id });
    assert.equal(await store.one('sessions', { _id: 'session' }), null);
    await store.insert('settings', { _id: 'token', kind: 'email-token', tokenHash: 'hash' });
    assert.equal(await store.take('settings', { _id: 'token', tokenHash: 'wrong' }), null);
    assert.equal((await store.take('settings', { _id: 'token', tokenHash: 'hash' }))._id, 'token');
    assert.equal(await store.take('settings', { _id: 'token', tokenHash: 'hash' }), null);
    await assert.rejects(store.find('invalid'), /Unknown collection/);
    const rls = await db.query("SELECT relrowsecurity FROM pg_class WHERE oid = 'aikrhis_private.records'::regclass");
    assert.equal(rls.rows[0].relrowsecurity, true);
    const access = await db.query("SELECT has_schema_privilege('anon','aikrhis_private','USAGE') AS anon, has_table_privilege('authenticated','aikrhis_private.records','SELECT') AS authenticated");
    assert.deepEqual(access.rows[0], { anon: false, authenticated: false });
    await store.insert('sessions', { _id: 'expired', expiresAt: Date.now() - 60000 });
    await store.close();
    store = await createStore({ storage: 'postgres', postgresUrl: 'postgresql://postgres:test@localhost/postgres' });
    assert.equal(await store.one('sessions', { _id: 'expired' }), null);
    assert.equal((await store.one('users', { _id: first._id })).name, 'Changed');
  } finally { await store?.close(); await db.close(); }
});

test('PostgreSQL requires a connection URI and unknown storage fails explicitly', async () => {
  await assert.rejects(createStore({ storage: 'postgres' }), /DATABASE_URL/);
  await assert.rejects(createStore({ storage: 'postgres', postgresUrl: 'https://example.com' }), /PostgreSQL URI/);
  await assert.rejects(createStore({ storage: 'typo' }), /Unknown storage/);
});

test('users migration preserves existing account data and never restores stale backups on restart', async t => {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA aikrhis_private;
    CREATE TABLE aikrhis_private.records (collection text NOT NULL, id text NOT NULL, value jsonb NOT NULL, PRIMARY KEY(collection,id));`);
  const account = { _id: 'existing-user', name: 'Existing User', email: 'existing@example.com', role: 'user', active: true, emailVerified: true, authVersion: 4, passwordHash: 'preserved-hash', failedLogins: [123], createdAt: '2026-01-01' };
  await db.query('INSERT INTO aikrhis_private.records VALUES ($1,$2,$3::jsonb)', ['users', account._id, JSON.stringify(account)]);
  t.mock.method(Pool.prototype, 'query', (sql, values) => db.query(sql, values));
  t.mock.method(Pool.prototype, 'end', async () => {});
  let store;
  const config = { storage: 'postgres', postgresUrl: 'postgresql://postgres:test@localhost/postgres' };
  try {
    store = await createStore(config);
    assert.deepEqual(await store.one('users', { _id: account._id }), account);
    const columns = await db.query('SELECT name,email,role,email_verified,active FROM public.users WHERE id=$1', [account._id]);
    assert.deepEqual(columns.rows[0], { name: account.name, email: account.email, role: 'user', email_verified: true, active: true });
    await store.update('users', account._id, { name: 'Updated User' });
    await store.close();
    store = await createStore(config);
    assert.equal((await store.one('users', { _id: account._id })).name, 'Updated User');
    const protectedTable = await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.users'::regclass");
    assert.equal(protectedTable.rows[0].relrowsecurity, true);
    const access = await db.query("SELECT has_table_privilege('anon','public.users','SELECT') AS anon, has_table_privilege('authenticated','public.users','SELECT') AS authenticated");
    assert.deepEqual(access.rows[0], { anon: false, authenticated: false });
    await store.remove('users', { _id: account._id });
    await store.close();
    store = await createStore(config);
    assert.equal(await store.one('users', { _id: account._id }), null);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM aikrhis_private.records WHERE collection='users'")).rows[0].count, 1);
  } finally { await store?.close(); await db.close(); }
});
