'use strict';
const { scrypt, randomBytes, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const derive = promisify(scrypt);
const OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    throw Object.assign(new Error('Use a password with 12 to 128 characters.'), { status: 400 });
  }
}
async function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt, 64, OPTIONS);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}
async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [, salt, hash] = String(encoded).split('$');
  if (!salt || !hash || !/^[a-f0-9]{128}$/.test(hash)) return false;
  const derived = await derive(password, salt, 64, OPTIONS);
  return timingSafeEqual(derived, Buffer.from(hash, 'hex'));
}
module.exports = { hashPassword, verifyPassword, validatePassword };
