(function exposeCipherTools(root, factory) {
  const tools = factory();
  if (typeof module === 'object' && module.exports) module.exports = tools;
  else root.Ciphers = tools;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCipherTools() {
  'use strict';

  // ------------------------------ Caesar Cipher ------------------------------

  function normalizeShift(shift) {
    const value = Number.parseInt(shift, 10);
    if (!Number.isFinite(value)) throw new TypeError('Shift must be a number.');
    return ((value % 26) + 26) % 26;
  }

  function shiftChar(char, shift) {
    if (!/[a-zA-Z]/.test(char)) return char;
    const base = char >= 'A' && char <= 'Z' ? 65 : 97;
    const position = char.charCodeAt(0) - base;
    const newPosition = ((position + shift) % 26 + 26) % 26;
    return String.fromCharCode(newPosition + base);
  }

  function caesarEncrypt(text, shift) {
    const amount = normalizeShift(shift);
    return String(text).split('').map(char => shiftChar(char, amount)).join('');
  }

  function caesarDecrypt(text, shift) {
    const amount = normalizeShift(shift);
    return String(text).split('').map(char => shiftChar(char, -amount)).join('');
  }

  // ----------------------------- Playfair Cipher ------------------------------

  const PLAYFAIR_ALPHABET = 'ABCDEFGHIKLMNOPQRSTUVWXYZ';

  function normalizePlayfairText(value) {
    return String(value).toUpperCase().replace(/J/g, 'I').replace(/[^A-Z]/g, '');
  }

  function buildGrid(key) {
    const uniqueLetters = [...new Set(normalizePlayfairText(key) + PLAYFAIR_ALPHABET)];
    return Array.from({ length: 5 }, (_, row) => uniqueLetters.slice(row * 5, row * 5 + 5));
  }

  function requirePlayfairKey(key) {
    if (!normalizePlayfairText(key)) {
      throw new Error('Playfair key must contain at least one letter.');
    }
  }

  function prepareDigraphs(text) {
    const letters = normalizePlayfairText(text);
    const pairs = [];
    let index = 0;

    while (index < letters.length) {
      const first = letters[index];
      const second = letters[index + 1];

      if (!second) {
        pairs.push(first + 'X');
        index += 1;
      } else if (first === second) {
        pairs.push(first + 'X');
        index += 1;
      } else {
        pairs.push(first + second);
        index += 2;
      }
    }
    return pairs;
  }

  function cipherDigraphs(cipherText) {
    const letters = normalizePlayfairText(cipherText);
    if (letters.length % 2 !== 0) throw new Error('Playfair ciphertext must contain an even number of letters.');
    return letters.match(/.{2}/g) || [];
  }

  function findPosition(letter, grid) {
    for (let row = 0; row < 5; row += 1) {
      const column = grid[row].indexOf(letter);
      if (column !== -1) return { row, column };
    }
    throw new Error(`Letter ${letter} is missing from the Playfair grid.`);
  }

  function transformPair(pair, grid, direction) {
    const first = findPosition(pair[0], grid);
    const second = findPosition(pair[1], grid);

    if (first.row === second.row) {
      return grid[first.row][(first.column + direction + 5) % 5]
        + grid[second.row][(second.column + direction + 5) % 5];
    }
    if (first.column === second.column) {
      return grid[(first.row + direction + 5) % 5][first.column]
        + grid[(second.row + direction + 5) % 5][second.column];
    }
    return grid[first.row][second.column] + grid[second.row][first.column];
  }

  function encryptPair(pair, grid) {
    return transformPair(pair, grid, 1);
  }

  function decryptPair(pair, grid) {
    return transformPair(pair, grid, -1);
  }

  function playfairEncrypt(text, key) {
    requirePlayfairKey(key);
    const grid = buildGrid(key);
    return prepareDigraphs(text).map(pair => encryptPair(pair, grid)).join(' ');
  }

  function playfairDecrypt(cipherText, key) {
    requirePlayfairKey(key);
    const grid = buildGrid(key);
    return cipherDigraphs(cipherText).map(pair => decryptPair(pair, grid)).join(' ');
  }

  // ----------------------------- Vigenere Cipher -----------------------------

  function normalizeAlphabetKey(key) {
    const normalized = String(key).toUpperCase().replace(/[^A-Z]/g, '');
    if (!normalized) throw new Error('Cipher key must contain at least one letter.');
    return normalized;
  }

  function vigenereTransform(text, key, direction) {
    const normalizedKey = normalizeAlphabetKey(key);
    let keyIndex = 0;
    return String(text).split('').map(char => {
      if (!/[A-Za-z]/.test(char)) return char;
      const amount = normalizedKey.charCodeAt(keyIndex++ % normalizedKey.length) - 65;
      return shiftChar(char, amount * direction);
    }).join('');
  }

  function vigenereEncrypt(text, key) {
    return vigenereTransform(text, key, 1);
  }

  function vigenereDecrypt(text, key) {
    return vigenereTransform(text, key, -1);
  }

  // -------------------------------- Bifid Cipher ------------------------------

  function normalizePeriod(period) {
    const value = Number.parseInt(period, 10);
    if (!Number.isFinite(value) || value < 1) throw new Error('Bifid period must be at least 1.');
    return value;
  }

  function bifidTransform(text, key, period, decrypting) {
    const normalizedKey = normalizeAlphabetKey(key);
    const grid = buildGrid(normalizedKey);
    const letters = grid.flat();
    const input = normalizePlayfairText(text);
    const size = normalizePeriod(period);
    let output = '';

    for (let start = 0; start < input.length; start += size) {
      const block = input.slice(start, start + size);
      let coordinates = [];
      if (decrypting) {
        const stream = [...block].map(letter => {
          const index = letters.indexOf(letter);
          return [Math.floor(index / 5) + 1, (index % 5) + 1];
        }).flat();
        const half = block.length;
        coordinates = Array.from({ length: half }, (_, index) => [stream[index], stream[index + half]]);
      } else {
        const pairs = [...block].map(letter => {
          const index = letters.indexOf(letter);
          return [Math.floor(index / 5) + 1, (index % 5) + 1];
        });
        const stream = pairs.map(pair => pair[0]).concat(pairs.map(pair => pair[1]));
        coordinates = Array.from({ length: block.length }, (_, index) => [stream[index * 2], stream[index * 2 + 1]]);
      }
      output += coordinates.map(([row, column]) => grid[row - 1][column - 1]).join('');
    }
    return output;
  }

  function bifidEncrypt(text, key, period = 5) {
    return bifidTransform(text, key, period, false);
  }

  function bifidDecrypt(text, key, period = 5) {
    return bifidTransform(text, key, period, true);
  }

  return {
    shiftChar,
    caesarEncrypt,
    caesarDecrypt,
    normalizePlayfairText,
    buildGrid,
    prepareDigraphs,
    encryptPair,
    decryptPair,
    playfairEncrypt,
    playfairDecrypt,
    vigenereEncrypt,
    vigenereDecrypt,
    bifidEncrypt,
    bifidDecrypt
  };
});
