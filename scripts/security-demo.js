'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createServer } = require('../app');
const { runScenarios, DEMO_PASSWORD, ADMIN_EMAIL } = require('./security-scenarios');

(async () => {
  const serve = process.argv.includes('--serve');
  const server = createServer({ storage: 'sqlite', dbPath: ':memory:', origin: undefined, secureCookies: false, mailer: { available: false } });
  let running = false;
  try {
    await server.ready;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(serve ? 3001 : 0, '127.0.0.1', resolve); });
    running = true;
    const { report } = await runScenarios(server);
    await fs.mkdir(path.join(__dirname, '../data'), { recursive: true });
    await fs.writeFile(path.join(__dirname, '../data/security-demo-report.json'), JSON.stringify(report, null, 2));
    for (const scenario of report.scenarios) console.log(`PASS ${scenario.scenario}: ${scenario.name}`);
    console.log('Evidence: data/security-demo-report.json');
    if (serve) {
      console.log('Demo dashboard: http://localhost:3001');
      console.log(`Demo administrator: ${ADMIN_EMAIL}`);
      console.log(`Demo password (isolated classroom accounts only): ${DEMO_PASSWORD}`);
      console.log('Normal user: normal@demo.example; lockout user: lockout@demo.example; suspicious user: suspicious@demo.example');
      console.log('Use Ctrl+C to stop. Restart this demo to reset its data.');
      for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(async () => { await server.security.drainMail(); await server.store.close(); process.exit(0); }));
      return;
    }
  } catch (error) { console.error(`Security demo failed: ${error.message}`); process.exitCode = 1; }
  await server.security?.drainMail();
  if (running) await new Promise(resolve => server.close(resolve));
  await server.store?.close();
})();
