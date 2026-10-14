const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const server = require('../app').createServer({ storage: 'sqlite', dbPath: ':memory:' });

function request(pathname) {
  const address = server.address();

  return new Promise((resolve, reject) => {
    const requestHandle = http.get({
      hostname: '127.0.0.1',
      port: address.port,
      path: pathname
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({
        statusCode: response.statusCode,
        contentType: response.headers['content-type'],
        body
      }));
    });

    requestHandle.on('error', reject);
  });
}

test.before(async () => {
  await server.ready;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
});
test.after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await server.store.close();
});

test('health endpoint responds successfully', async () => {
  const response = await request('/health');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { status: 'ok' });
});

test('home page and health endpoint accept query parameters', async () => {
  const page = await request('/?demo=1');
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /<title>Aikrhis/);
  const health = await request('/health?check=1');
  assert.equal(health.statusCode, 200);
  assert.deepEqual(JSON.parse(health.body), { status: 'ok' });
});

test('rejects malformed paths without stopping the server', async () => {
  for (const pathname of ['/%zz', '//[invalid']) {
    const response = await request(pathname);
    assert.equal(response.statusCode, 400);
  }
  assert.equal((await request('/health')).statusCode, 200);
});

test('blocks encoded directory traversal and reports missing files', async () => {
  assert.equal((await request('/%2e%2e%2fapp.js')).statusCode, 403);
  assert.equal((await request('/missing-file.js')).statusCode, 404);
});

test('serves the complete Aikrhis interface and assets', async () => {
  const [page, styles, gameTheme, client, auth, securityClient] = await Promise.all([
    request('/'),
    request('/cipherlab.css'),
    request('/game-theme.css'),
    request('/app.js'),
    request('/auth.js'),
    request('/security-center.js')
  ]);

  assert.equal(page.statusCode, 200);
  assert.match(page.contentType, /^text\/html/);
  assert.match(page.body, /<title>Aikrhis/);
  assert.match(page.body, /class="system-logo"/);
  assert.match(page.body, /id="keyword"/);
  assert.match(page.body, /id="matrix"/);
  assert.match(page.body, /data-cipher="caesar"/);
  assert.match(page.body, /data-cipher="playfair"/);
  assert.match(page.body, /id="open-login"/);
  assert.match(page.body, /id="open-signup"/);
  assert.match(page.body, /id="auth-modal"/);
  assert.match(page.body, /id="forgot-form"/);
  assert.match(page.body, /id="reset-form"/);
  assert.match(page.body, /id="verify-form"/);
  assert.match(page.body, /id="resend-verification"/);
  assert.match(page.body, /game-theme\.css/);
  assert.match(page.body, /Command the cipher/);
  assert.doesNotMatch(page.body, /bot-companion|aikrhis-bot-pet|companion\.js/);
  assert.doesNotMatch(page.body, /class="hero-stats"/);

  assert.equal(styles.statusCode, 200);
  assert.match(styles.contentType, /^text\/css/);
  assert.match(styles.body, /@media \(max-width: 767px\)/);
  assert.match(styles.body, /overflow-x: hidden/);
  assert.match(styles.body, /@keyframes card-enter/);
  assert.match(styles.body, /@keyframes matrix-cell-enter/);
  assert.match(styles.body, /@media \(prefers-reduced-motion: reduce\)/);

  assert.equal(gameTheme.statusCode, 200);
  assert.match(gameTheme.contentType, /^text\/css/);
  assert.match(gameTheme.body, /LIVE CIPHER MODULE/);
  assert.match(gameTheme.body, /\.mission-strip/);
  assert.match(gameTheme.body, /@media \(max-width: 767px\)/);

  assert.equal(client.statusCode, 200);
  assert.match(client.contentType, /^text\/javascript/);
  assert.match(client.body, /SecurityAPI\.request\('\/api\/cipher'/);
  assert.match(client.body, /animateInterfaceChange/);

  assert.equal(auth.statusCode, 200);
  assert.match(auth.contentType, /^text\/javascript/);
  assert.match(auth.body, /window\.SecurityAPI/);
  assert.match(auth.body, /\/api\/auth\//);
  assert.match(auth.body, /api\.setSession/);

  assert.equal(securityClient.statusCode, 200);
  assert.match(securityClient.contentType, /^text\/javascript/);
});
