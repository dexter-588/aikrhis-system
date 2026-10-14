'use strict';
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const dotenv = require('dotenv');
const { createStore } = require('./src/store');
const { SecurityService } = require('./src/security');
dotenv.config({ path: path.join(__dirname, '.env'), quiet: true });

function configuration(overrides = {}) {
  const vercelOrigin = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined;
  return { host: process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'), port: Number(process.env.PORT) || 3000, storage: process.env.SECURITY_STORAGE || 'postgres', postgresUrl: process.env.DATABASE_URL, postgresCaPath: process.env.PGSSLROOTCERT, postgresPoolMax: Number(process.env.PGPOOL_MAX) || (process.env.VERCEL ? 1 : 5), mongoUri: process.env.MONGODB_URI, database: process.env.SECURITY_DATABASE || 'aikrhis_security', dbPath: process.env.SECURITY_SQLITE_PATH, secureCookies: process.env.NODE_ENV === 'production', origin: process.env.PUBLIC_ORIGIN || vercelOrigin,
    mail: { production: process.env.NODE_ENV === 'production', mode: process.env.MAIL_MODE, host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, user: process.env.SMTP_USER, password: process.env.SMTP_PASSWORD, from: process.env.MAIL_FROM }, ...overrides };
}
function createServer(options = {}) {
  const config = configuration(options);
  const app = express();
  app.disable('x-powered-by');
  const server = http.createServer(app);
  server.ready = createStore(config).then(store => {
    server.store = store;
    server.security = new SecurityService(store, config);
    return server.security;
  });
  server.ready.catch(() => {});
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'");
    if (config.secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try { req.safePath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { return res.status(400).send('Bad request'); }
    next();
  });
  app.get('/health', async (req, res) => {
    try { await server.ready; res.json({ status: 'ok' }); }
    catch { res.status(503).json({ status: 'unavailable' }); }
  });
  app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use(express.json({ limit: '32kb', strict: true }));
  app.use(async (req, res, next) => {
    if (!req.safePath.startsWith('/api/')) return next();
    try {
      const security = await server.ready;
      const result = await security.run(() => security.handle(req, res));
      if (!res.headersSent) res.json(result);
    } catch (error) {
      if (res.headersSent) return;
      if (error.status) return res.status(error.status).json({ error: error.message });
      if (error.code === 11000 || error.code === '23505' || error.code === 'ERR_SQLITE_ERROR') return res.status(409).json({ error: 'This record already exists.' });
      console.error('Security request failed:', error.name);
      res.status(503).json({ error: 'Security service unavailable. Try again later.' });
    }
  });
  const publicDirectory = path.join(__dirname, 'public');
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png' };
  app.use((req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).send('Method not allowed');
    if (req.safePath === '/dashboard/') return res.redirect(302, '/dashboard');
    const filePath = path.resolve(publicDirectory, `.${['/', '/dashboard'].includes(req.safePath) ? '/index.html' : req.safePath}`);
    if (!filePath.startsWith(`${publicDirectory}${path.sep}`)) return res.status(403).send('Forbidden');
    fs.readFile(filePath, (error, data) => {
      if (error) return res.status(404).send('Not found');
      res.setHeader('Content-Type', types[path.extname(filePath)] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: 'Invalid request body.' });
  });
  return server;
}
if (require.main === module) {
  const config = configuration();
  const server = createServer(config);
  server.ready.then(() => {
    server.listen(config.port, config.host, () => console.log(`Aikrhis is ready at ${config.origin || `http://localhost:${server.address().port}`} (${server.store.kind})`));
  }).catch(error => {
    const certificateErrors = ['SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'];
    if (certificateErrors.includes(error.code)) {
      console.error('Startup failed: PostgreSQL TLS certificate could not be verified. Download the Supabase CA certificate from Database > Settings > SSL Configuration and set PGSSLROOTCERT in .env to its file path.');
    } else {
      console.error(`Startup failed (${error.code || error.name}). Check database configuration; no storage fallback was used.`);
    }
    process.exitCode = 1;
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(async () => { await server.store?.close(); process.exit(0); }));
}
module.exports = { createServer, configuration };
