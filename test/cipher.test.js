const test = require('node:test');
const assert = require('node:assert/strict');
const {
  shiftChar, caesarEncrypt, caesarDecrypt, buildGrid, prepareDigraphs,
  encryptPair, decryptPair, playfairEncrypt, playfairDecrypt,
  vigenereEncrypt, vigenereDecrypt, bifidEncrypt, bifidDecrypt
} = require('../public/cipher');

test('Caesar encrypt: hello + 1 = ifmmp', () => assert.equal(caesarEncrypt('hello', 1), 'ifmmp'));
test('Caesar decrypt: ifmmp - 1 = hello', () => assert.equal(caesarDecrypt('ifmmp', 1), 'hello'));
test('Caesar preserves case and non-letters', () => {
  assert.equal(caesarEncrypt('Hello, Z9!', 1), 'Ifmmp, A9!');
  assert.equal(shiftChar('A', -1), 'Z');
  assert.equal(caesarEncrypt('  Az!\n', 1), '  Ba!\n');
});

test('Caesar round-trips every letter at every allowed shift', () => {
  const sample = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123 !?';
  for (let shift = 1; shift <= 25; shift += 1) {
    assert.equal(caesarDecrypt(caesarEncrypt(sample, shift), shift), sample);
  }
});

test('Playfair builds the exact PLAYFAIR grid', () => {
  assert.deepEqual(buildGrid('PLAYFAIR'), [
    ['P', 'L', 'A', 'Y', 'F'],
    ['I', 'R', 'B', 'C', 'D'],
    ['E', 'G', 'H', 'K', 'M'],
    ['N', 'O', 'Q', 'S', 'T'],
    ['U', 'V', 'W', 'X', 'Z']
  ]);
});

test('Playfair prepares HELLO as HE, LX, LO', () => {
  assert.deepEqual(prepareDigraphs('HELLO'), ['HE', 'LX', 'LO']);
  assert.deepEqual(prepareDigraphs('CAT'), ['CA', 'TX']);
});

test('Playfair removes duplicate key letters and merges J into I', () => {
  const letters = buildGrid('JIGGLE!!').flat();
  assert.equal(letters.length, 25);
  assert.equal(new Set(letters).size, 25);
  assert.equal(letters.includes('J'), false);
  assert.deepEqual(letters.slice(0, 4), ['I', 'G', 'L', 'E']);
});

test('Playfair pair encryption and decryption are inverse operations', () => {
  const grid = buildGrid('PLAYFAIR');
  const letters = grid.flat();
  for (const first of letters) {
    for (const second of letters) {
      const pair = first + second;
      assert.equal(decryptPair(encryptPair(pair, grid), grid), pair);
    }
  }
});

test('Playfair encrypt/decrypt round-trip preserves prepared plaintext', () => {
  const encrypted = playfairEncrypt('HELLO', 'PLAYFAIR');
  assert.equal(encrypted, 'KG YV RV');
  assert.equal(playfairDecrypt(encrypted, 'PLAYFAIR'), 'HE LX LO');
});

test('Playfair rejects odd-length ciphertext during decryption', () => {
  assert.throws(() => playfairDecrypt('ABC', 'KEY'), /even number/);
});

test('Playfair rejects an empty or non-letter key', () => {
  assert.throws(() => playfairEncrypt('HELLO', '123 !'), /key must contain/);
  assert.throws(() => playfairDecrypt('KGYVRV', ''), /key must contain/);
});

test('Playfair matches canonical MONARCHY vector', () => {
  assert.equal(playfairEncrypt('INSTRUMENTS', 'MONARCHY'), 'GA TL MZ CL RQ XA');
  assert.equal(playfairDecrypt('GATLMZCLRQXA', 'MONARCHY'), 'IN ST RU ME NT SX');
});

test('Vigenere matches its canonical vector and round-trips formatting', () => {
  assert.equal(vigenereEncrypt('ATTACKATDAWN', 'LEMON'), 'LXFOPVEFRNHR');
  const sample = 'Attack at Dawn! 09';
  assert.equal(vigenereDecrypt(vigenereEncrypt(sample, 'LEMON'), 'LEMON'), sample);
});

test('Bifid round-trips normalized text across periods', () => {
  for (const period of [1, 5, 13]) {
    const encrypted = bifidEncrypt('DEFEND THE EAST!', 'FORTIFICATION', period);
    assert.equal(bifidDecrypt(encrypted, 'FORTIFICATION', period), 'DEFENDTHEEAST');
  }
});

test('Vigenere and Bifid reject empty alphabetic keys', () => {
  assert.throws(() => vigenereEncrypt('HELLO', '123'), /key must contain/);
  assert.throws(() => bifidEncrypt('HELLO', ''), /key must contain/);
});
