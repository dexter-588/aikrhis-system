'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { configuration } = require('../app');
const { createStore } = require('../src/store');

(async () => {
  let source;
  let target;
  try {
    const config = configuration({ storage: 'postgres' });
    const sourcePath = config.dbPath || path.join(__dirname, '../data/security.sqlite');
    if (!fs.existsSync(sourcePath)) throw new Error('Local SQLite database not found.');
    source = new DatabaseSync(sourcePath, { readOnly: true });
    const users = source.prepare("SELECT value FROM records WHERE collection='users'").all().map(row => JSON.parse(row.value));
    target = await createStore(config);
    let copied = 0;
    let skipped = 0;
    for (const user of users) {
      const existing = await target.one('users', { _id: user._id });
      if (existing) { skipped++; continue; }
      if (await target.one('users', { email: user.email })) throw new Error('An account with the same email already exists under another ID. No existing account was overwritten.');
      await target.insert('users', user);
      copied++;
    }
    console.log(`SQLite users copied to Supabase: ${copied}; already present: ${skipped}.`);
    console.log('The local database is unchanged. Start the app with SECURITY_STORAGE=postgres.');
  } catch (error) {
    console.error(error.code ? `User migration failed (${error.code}).` : error.message);
    process.exitCode = 1;
  } finally { source?.close(); await target?.close(); }
})();
