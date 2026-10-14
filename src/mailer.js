'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const nodemailer = require('nodemailer');

function createMailer(options = {}) {
  const mode = options.mode || (options.production ? 'smtp' : 'preview');
  if (mode === 'preview' && !options.production) {
    const directory = options.directory || path.join(__dirname, '../data/mail');
    return {
      available: true,
      mode,
      async send({ to, subject, text }) {
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(path.join(directory, `${Date.now()}-${randomUUID()}.txt`), `To: ${to}\nSubject: ${subject}\n\n${text}\n`, { mode: 0o600 });
      }
    };
  }
  if (mode !== 'smtp' || !options.host || !options.from || !options.user || !options.password) {
    return { available: false, mode, async send() { throw new Error('Email delivery is not configured.'); } };
  }
  const port = Number(options.port) || 587;
  const transport = nodemailer.createTransport({
    host: options.host, port, secure: port === 465, requireTLS: port !== 465,
    auth: { user: options.user, pass: options.password },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000
  });
  return { available: true, mode, async send(message) { await transport.sendMail({ ...message, from: options.from }); } };
}
module.exports = { createMailer };
