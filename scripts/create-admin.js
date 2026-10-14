'use strict';
const readline = require('node:readline/promises');
const { Writable } = require('node:stream');
const { configuration } = require('../app');
const { createStore } = require('../src/store');
const { SecurityService } = require('../src/security');
(async () => {
  let store;
  let muted = false;
  const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk); callback(); } });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) });
  try {
    const name = process.env.AIKRHIS_ADMIN_NAME || await rl.question('Admin name: ');
    const email = process.env.AIKRHIS_ADMIN_EMAIL || await rl.question('Admin email: ');
    let password = process.env.AIKRHIS_ADMIN_PASSWORD;
    if (!password) {
      if (!process.stdin.isTTY) throw new Error('Provide AIKRHIS_ADMIN_PASSWORD for noninteractive setup.');
      process.stdout.write('Password (12+ characters, hidden): ');
      muted = true;
      password = await rl.question('');
      muted = false;
      process.stdout.write('\n');
    }
    store = await createStore(configuration());
    await new SecurityService(store).bootstrap(name, email, password);
    console.log('Administrator created. Sign in with your chosen credentials.');
  } catch (error) { console.error(error.status ? error.message : 'Admin setup failed. Check the database and account details.'); process.exitCode = 1; }
  finally { rl.close(); await store?.close(); }
})();
