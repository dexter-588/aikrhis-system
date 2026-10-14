'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const collections = new Set(['users', 'sessions', 'activities', 'account_logs', 'security_events', 'alerts', 'settings']);

function where(name, filter = {}) {
  if (!collections.has(name)) throw new Error('Unknown collection');
  const values = name === 'users' ? [] : [name];
  const bind = value => { values.push(value); return `$${values.length}`; };
  const clauses = [name === 'users' ? 'TRUE' : 'collection = $1'];
  for (const [key, value] of Object.entries(filter)) {
    if (value && Array.isArray(value.$in) && value.$in.length === 0) {
      clauses.push('FALSE');
      continue;
    }
    const field = `(value -> ${bind(key)}::text)`;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if ('$gte' in value) clauses.push(`${field} >= ${bind(JSON.stringify(value.$gte))}::jsonb`);
      else if ('$in' in value && Array.isArray(value.$in)) {
        clauses.push(value.$in.length ? `${field} IN (${value.$in.map(item => `${bind(JSON.stringify(item))}::jsonb`).join(', ')})` : 'FALSE');
      } else throw new Error('Unsupported filter');
    } else clauses.push(`${field} = ${bind(JSON.stringify(value))}::jsonb`);
  }
  return { sql: clauses.join(' AND '), values, table: name === 'users' ? 'public.users' : 'aikrhis_private.records' };
}

async function createPostgresStore(options) {
  if (!options.postgresUrl) throw new Error('Set DATABASE_URL to your Supabase PostgreSQL connection URI.');
  const url = new URL(options.postgresUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must be a PostgreSQL URI.');
  // Configure TLS explicitly so URI sslmode options cannot override CA validation.
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) url.searchParams.delete(key);
  const ssl = { rejectUnauthorized: true };
  if (options.postgresCaPath) {
    const certificatePath = path.isAbsolute(options.postgresCaPath)
      ? options.postgresCaPath
      : path.resolve(__dirname, '..', options.postgresCaPath);
    ssl.ca = fs.readFileSync(certificatePath, 'utf8');
  }
  const pool = new Pool({ connectionString: url.toString(), ssl, max: options.postgresPoolMax || 5, connectionTimeoutMillis: 10000 });
  pool.on('error', error => console.error('PostgreSQL pool error:', error.code || error.name));
  try {
    // A private schema keeps credentials and sessions outside Supabase's public Data API.
    await pool.query(`CREATE SCHEMA IF NOT EXISTS aikrhis_private`);
    await pool.query(`CREATE TABLE IF NOT EXISTS aikrhis_private.records (
      collection text NOT NULL, id text NOT NULL, value jsonb NOT NULL,
      PRIMARY KEY (collection, id),
      CHECK (collection IN ('users','sessions','activities','account_logs','security_events','alerts','settings'))
    )`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS records_user_email ON aikrhis_private.records ((value->>'email')) WHERE collection = 'users'`);
    await pool.query(`CREATE INDEX IF NOT EXISTS records_created_at ON aikrhis_private.records (collection, (value->>'createdAt'))`);
    await pool.query(`CREATE INDEX IF NOT EXISTS records_actor_id ON aikrhis_private.records (collection, (value->>'actorId'))`);
    await pool.query(`ALTER TABLE aikrhis_private.records ENABLE ROW LEVEL SECURITY`);
    await pool.query(`REVOKE ALL ON SCHEMA aikrhis_private FROM PUBLIC, anon, authenticated`);
    await pool.query(`REVOKE ALL ON aikrhis_private.records FROM PUBLIC, anon, authenticated`);
    await pool.query(`CREATE TABLE IF NOT EXISTS public.users (
      id text PRIMARY KEY,
      value jsonb NOT NULL,
      name text GENERATED ALWAYS AS (value->>'name') STORED,
      email text GENERATED ALWAYS AS (value->>'email') STORED UNIQUE,
      role text GENERATED ALWAYS AS (value->>'role') STORED,
      email_verified boolean GENERATED ALWAYS AS ((value->>'emailVerified')::boolean) STORED,
      active boolean GENERATED ALWAYS AS ((value->>'active')::boolean) STORED,
      created_at text GENERATED ALWAYS AS (value->>'createdAt') STORED
    )`);
    await pool.query(`ALTER TABLE public.users ENABLE ROW LEVEL SECURITY`);
    await pool.query(`REVOKE ALL ON public.users FROM PUBLIC, anon, authenticated`);
    // One atomic migration preserves account IDs, hashes, verification and session versions.
    // Original records remain as a backup; the marker prevents copying them again on restart.
    await pool.query(`DO $migration$
      BEGIN
        PERFORM pg_advisory_xact_lock(74821931);
        IF NOT EXISTS (SELECT 1 FROM aikrhis_private.records WHERE collection = 'settings' AND id = 'users-table-migration-v1') THEN
          LOCK TABLE aikrhis_private.records IN SHARE ROW EXCLUSIVE MODE;
          INSERT INTO public.users (id, value)
            SELECT id, value FROM aikrhis_private.records WHERE collection = 'users'
            ON CONFLICT (id) DO NOTHING;
          INSERT INTO aikrhis_private.records (collection, id, value)
            VALUES ('settings', 'users-table-migration-v1', '{"_id":"users-table-migration-v1","complete":true}'::jsonb);
        END IF;
      END $migration$`);
    await pool.query(`DELETE FROM aikrhis_private.records WHERE collection = 'sessions' AND (value->>'expiresAt')::bigint <= $1`, [Date.now()]);
    const store = {
      kind: 'postgres',
      async find(name, filter = {}, options = {}) {
        const query = where(name, filter);
        const [sortKey, direction] = Object.entries(options.sort || { _id: 1 })[0];
        query.values.push(sortKey, options.limit ?? 10000, options.skip ?? 0);
        const count = query.values.length;
        const result = await pool.query(`SELECT value FROM ${query.table} WHERE ${query.sql}
          ORDER BY (value -> $${count - 2}::text) ${direction === -1 ? 'DESC' : 'ASC'}, id ASC
          LIMIT $${count - 1} OFFSET $${count}`, query.values);
        return result.rows.map(row => row.value);
      },
      async one(name, filter) { return (await store.find(name, filter, { limit: 1 }))[0] || null; },
      async insert(name, value) {
        where(name);
        const row = { ...value, _id: value._id || randomUUID() };
        const result = name === 'users'
          ? await pool.query('INSERT INTO public.users (id, value) VALUES ($1, $2::jsonb) RETURNING value', [row._id, JSON.stringify(row)])
          : await pool.query('INSERT INTO aikrhis_private.records (collection, id, value) VALUES ($1, $2, $3::jsonb) RETURNING value', [name, row._id, JSON.stringify(row)]);
        return result.rows[0].value;
      },
      async update(name, id, patch) {
        where(name);
        const result = name === 'users'
          ? await pool.query('UPDATE public.users SET value = value || $2::jsonb WHERE id = $1 RETURNING value', [id, JSON.stringify({ ...patch, _id: id })])
          : await pool.query('UPDATE aikrhis_private.records SET value = value || $3::jsonb WHERE collection = $1 AND id = $2 RETURNING value', [name, id, JSON.stringify({ ...patch, _id: id })]);
        return result.rows[0]?.value || null;
      },
      async remove(name, filter) {
        const query = where(name, filter);
        await pool.query(`DELETE FROM ${query.table} WHERE ${query.sql}`, query.values);
      },
      async take(name, filter) {
        const query = where(name, filter);
        const result = await pool.query(`DELETE FROM ${query.table} WHERE ${query.sql} RETURNING value`, query.values);
        return result.rows[0]?.value || null;
      },
      async close() { await pool.end(); }
    };
    return store;
  } catch (error) { await pool.end(); throw error; }
}
module.exports = { createPostgresStore };
