'use strict';

const { randomUUID } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const collections = ['users', 'sessions', 'activities', 'account_logs', 'security_events', 'alerts', 'settings'];
function check(name) { if (!collections.includes(name)) throw new Error('Unknown collection'); }
function matches(row, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === 'object') {
      if ('$gte' in value) return row[key] >= value.$gte;
      if ('$in' in value) return value.$in.includes(row[key]);
    }
    return row[key] === value;
  });
}

async function createStore(options = {}) {
  if (options.storage === 'postgres') return require('./postgres-store').createPostgresStore(options);
  if (options.storage === 'sqlite') {
    const { DatabaseSync } = require('node:sqlite');
    const filename = options.dbPath || path.join(__dirname, '../data/security.sqlite');
    if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
    const db = new DatabaseSync(filename);
    db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL, id TEXT NOT NULL, email TEXT, value TEXT NOT NULL, PRIMARY KEY(collection,id), UNIQUE(collection,email));');
    return {
      kind: 'sqlite',
      async find(name, filter = {}, options = {}) {
        check(name);
        let rows = db.prepare('SELECT value FROM records WHERE collection=?').all(name).map(row => JSON.parse(row.value)).filter(row => matches(row, filter));
        if (options.sort) {
          const [key, direction] = Object.entries(options.sort)[0];
          rows.sort((a, b) => a[key] === b[key] ? 0 : (a[key] > b[key] ? 1 : -1) * direction);
        }
        return rows.slice(options.skip || 0, (options.skip || 0) + (options.limit || rows.length));
      },
      async one(name, filter) { return (await this.find(name, filter, { limit: 1 }))[0] || null; },
      async insert(name, value) {
        check(name);
        const row = { ...value, _id: value._id || randomUUID() };
        db.prepare('INSERT INTO records VALUES (?,?,?,?)').run(name, row._id, name === 'users' ? row.email : null, JSON.stringify(row));
        return row;
      },
      async update(name, id, patch) {
        check(name);
        const current = await this.one(name, { _id: id });
        if (!current) return null;
        const row = { ...current, ...patch, _id: id };
        db.prepare('UPDATE records SET value=?,email=? WHERE collection=? AND id=?').run(JSON.stringify(row), name === 'users' ? row.email : null, name, id);
        return row;
      },
      async remove(name, filter) {
        check(name);
        for (const row of await this.find(name, filter)) db.prepare('DELETE FROM records WHERE collection=? AND id=?').run(name, row._id);
      },
      async take(name, filter) {
        check(name);
        const row = await this.one(name, filter);
        if (!row) return null;
        // No await between checking the current value and deleting it.
        const current = db.prepare('SELECT value FROM records WHERE collection=? AND id=?').get(name, row._id);
        if (!current || !matches(JSON.parse(current.value), filter)) return null;
        const removed = db.prepare('DELETE FROM records WHERE collection=? AND id=? AND value=? RETURNING value').get(name, row._id, current.value);
        return removed ? JSON.parse(removed.value) : null;
      },
      async close() { db.close(); }
    };
  }

  if (options.storage !== 'mongodb') throw new Error('Unknown storage. Use postgres, mongodb, or sqlite.');
  const { MongoClient } = require('mongodb');
  if (!options.mongoUri) throw new Error('Set MONGODB_URI, or explicitly select SECURITY_STORAGE=sqlite for a local demo.');
  const client = new MongoClient(options.mongoUri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const db = client.db(options.database || 'aikrhis_security');
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    await db.collection('sessions').createIndex({ expiresAtDate: 1 }, { expireAfterSeconds: 0 });
    await db.collection('sessions').createIndex({ userId: 1 });
    for (const name of ['activities', 'account_logs', 'security_events', 'alerts']) {
      await db.collection(name).createIndex({ createdAt: -1 });
      await db.collection(name).createIndex({ actorId: 1, createdAt: -1 });
    }
    return {
      kind: 'mongodb',
      async find(name, filter = {}, options = {}) {
        check(name);
        return db.collection(name).find(filter).sort(options.sort || { _id: 1 }).skip(options.skip || 0).limit(options.limit || 10000).toArray();
      },
      async one(name, filter) { check(name); return db.collection(name).findOne(filter); },
      async insert(name, value) { check(name); const row = { ...value, _id: value._id || randomUUID() }; await db.collection(name).insertOne(row); return row; },
      async update(name, id, patch) { check(name); return db.collection(name).findOneAndUpdate({ _id: id }, { $set: patch }, { returnDocument: 'after' }); },
      async remove(name, filter) { check(name); await db.collection(name).deleteMany(filter); },
      async take(name, filter) { check(name); return db.collection(name).findOneAndDelete(filter); },
      async close() { await client.close(); }
    };
  } catch (error) { await client.close(); throw error; }
}
module.exports = { createStore };
