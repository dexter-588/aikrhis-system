'use strict';

const state = { cipher: 'caesar', mode: 'encrypt' };
const $ = selector => document.querySelector(selector);

const messageInput = $('#message');
const resultOutput = $('#result');
const keyInput = $('#keyword');
const keyError = $('#key-error');
const vigenereKey = $('#vigenere-key');
const vigenereKeyError = $('#vigenere-key-error');
const bifidKey = $('#bifid-key');
const bifidKeyError = $('#bifid-key-error');
const bifidPeriod = $('#bifid-period');
const shiftSlider = $('#shift');
const shiftNumber = $('#shift-number');
const shiftReadout = $('#shift-readout');
const processButton = $('#process');
const processLabel = $('.process-label');
const copyButton = $('#copy');
const copyLabel = $('#copy-label');
const resultTerminal = $('#result-terminal');
const formMessage = $('#form-message');
const notice = $('#notice');

let copyResetTimer;
let interfaceAnimationTimer;
let previewAnimationTimer;
let actionAnimationTimer;
let processing = false;
let operationVersion = 0;
let restrictionTimer;

function normalizedKey() {
  return Ciphers.normalizePlayfairText(keyInput.value);
}

function renderGrid() {
  const keyLetters = new Set(normalizedKey());
  const grid = Ciphers.buildGrid(keyInput.value);

  $('#matrix').innerHTML = grid.flat().map((letter, index) => {
    const display = letter === 'I' ? 'I/J' : letter;
    const className = keyLetters.has(letter) ? ' class="key"' : '';
    return `<span${className} style="--cell-index:${index}">${display}</span>`;
  }).join('');
}

function renderBifidGrid() {
  const keyLetters = new Set(Ciphers.normalizePlayfairText(bifidKey.value));
  $('#bifid-matrix').innerHTML = Ciphers.buildGrid(bifidKey.value).flat().map((letter, index) => {
    const display = letter === 'I' ? 'I/J' : letter;
    return `<span${keyLetters.has(letter) ? ' class="key"' : ''} style="--cell-index:${index}">${display}</span>`;
  }).join('');
}

function cipherName() {
  return { caesar: 'Caesar', playfair: 'Playfair', vigenere: 'Vigenère', bifid: 'Bifid' }[state.cipher];
}

function getValidation() {
  if (window.SecurityAPI.user?.role === 'admin') return { valid: false, field: 'login', message: 'The cipher workspace is for user accounts only.' };
  if (window.SecurityAPI.user?.cipherRestrictedUntil > Date.now()) return { valid: false, field: 'login', message: 'Cipher access is temporarily paused after unusual activity. Wait one minute or contact an administrator.' };
  if (!window.SecurityAPI.user) return { valid: false, field: 'login', message: 'ACCESS REQUIRED // Sign in to execute a cipher operation.' };
  if (!messageInput.value.trim()) {
    return { valid: false, field: 'message', message: 'PAYLOAD REQUIRED // Enter a message to enable execution.' };
  }

  if (state.cipher === 'playfair' && !normalizedKey()) {
    return { valid: false, field: 'key', message: 'KEY REQUIRED // Enter a Playfair secret key.' };
  }

  if (state.cipher === 'vigenere' && !vigenereKey.value) return { valid: false, field: 'vigenere-key', message: 'KEY REQUIRED // Enter a Vigenère repeating key.' };
  if (state.cipher === 'bifid' && !bifidKey.value) return { valid: false, field: 'bifid-key', message: 'KEY REQUIRED // Enter a Bifid square key.' };

  return { valid: true, field: null, message: `SYSTEM READY // ${cipherName()} ${state.mode}ion configured.` };
}

function updateProcessState(showError = false) {
  const validation = getValidation();
  processButton.disabled = !validation.valid || processing;
  processButton.setAttribute('aria-disabled', String(processButton.disabled));
  formMessage.textContent = validation.message;
  formMessage.classList.toggle('error', showError && !validation.valid);

  const keyIsInvalid = state.cipher === 'playfair' && validation.field === 'key';
  keyInput.setAttribute('aria-invalid', String(showError && keyIsInvalid));
  if (!keyIsInvalid || !showError) keyError.textContent = '';
  vigenereKey.setAttribute('aria-invalid', String(showError && validation.field === 'vigenere-key'));
  bifidKey.setAttribute('aria-invalid', String(showError && validation.field === 'bifid-key'));
}

function setDefaultNotice() {
  notice.classList.remove('success', 'warning');
  notice.textContent = {
    caesar: `SHIFT VECTOR // ${shiftSlider.value} alphabet position${shiftSlider.value === '1' ? '' : 's'} selected.`,
    playfair: 'PAIR FORMAT // Output is grouped into pairs. X may separate repeated letters or pad the final pair.',
    vigenere: 'KEY STREAM // The keyword repeats across letters; punctuation does not consume it.',
    bifid: `FRACTIONATION // Coordinates are mixed in blocks of ${bifidPeriod.value || 5}.`
  }[state.cipher];
}

function resetCopyButton() {
  window.clearTimeout(copyResetTimer);
  copyLabel.textContent = 'Copy';
  copyButton.classList.remove('copied');
}

function clearResult() {
  operationVersion += 1;
  resultOutput.value = '';
  resultTerminal.classList.remove('has-result');
  copyButton.disabled = true;
  window.clearTimeout(actionAnimationTimer);
  processButton.classList.remove('is-complete');
  resetCopyButton();
  setDefaultNotice();
}

function animateInterfaceChange() {
  const cipherCard = $('#cipher-tool');
  window.clearTimeout(interfaceAnimationTimer);
  cipherCard.classList.remove('interface-changing');
  void cipherCard.offsetWidth;
  cipherCard.classList.add('interface-changing');
  interfaceAnimationTimer = window.setTimeout(() => {
    cipherCard.classList.remove('interface-changing');
  }, 300);
}

function animateShiftPreview() {
  const mappingChips = $('.mapping-chips');
  window.clearTimeout(previewAnimationTimer);
  mappingChips.classList.remove('is-updating');
  shiftReadout.classList.remove('is-updating');
  void mappingChips.offsetWidth;
  mappingChips.classList.add('is-updating');
  shiftReadout.classList.add('is-updating');
  previewAnimationTimer = window.setTimeout(() => {
    mappingChips.classList.remove('is-updating');
    shiftReadout.classList.remove('is-updating');
  }, 340);
}

function animateActionCompletion() {
  window.clearTimeout(actionAnimationTimer);
  processButton.classList.remove('is-complete');
  void processButton.offsetWidth;
  processButton.classList.add('is-complete');
  actionAnimationTimer = window.setTimeout(() => {
    processButton.classList.remove('is-complete');
  }, 440);
}

function renderInterface() {
  const resultAction = state.mode === 'encrypt' ? 'Encrypted' : 'Decrypted';
  const operation = state.mode === 'encrypt' ? 'encryption' : 'decryption';

  ['caesar', 'playfair', 'vigenere', 'bifid'].forEach(cipher => {
    const inactive = state.cipher !== cipher;
    $(`#${cipher}-options`).classList.toggle('hidden', inactive);
    $(`#${cipher}-options`).setAttribute('aria-hidden', String(inactive));
  });

  document.querySelectorAll('.tab').forEach(button => {
    const active = button.dataset.cipher === state.cipher;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });

  document.querySelectorAll('.mode').forEach(button => {
    const active = button.dataset.mode === state.mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });

  processLabel.textContent = `Execute ${operation}`;
  $('#result-label').textContent = `${resultAction} output`;
  resultOutput.placeholder = `Awaiting ${resultAction.toLowerCase()} output...`;
  $('#info-title').textContent = `Protocol brief // ${cipherName()}`;
  $('#info-text').textContent = {
    caesar: 'Each letter moves by the selected shift. Case is preserved, while spaces, numbers, and punctuation stay unchanged.',
    playfair: 'A keyword creates a 5 × 5 letter grid. Pairs move by row, column, or rectangle rules; I and J share one cell.',
    vigenere: 'A repeating keyword applies a different Caesar shift to each letter. Case and non-letters are preserved.',
    bifid: 'A keyed Polybius square converts letters to coordinates, then mixes them by block. I and J share one cell.'
  }[state.cipher];

  updateProcessState();
  setDefaultNotice();
}

function updateShift(value) {
  const safeValue = Math.min(25, Math.max(1, Number.parseInt(value, 10) || 1));
  shiftSlider.value = String(safeValue);
  shiftNumber.value = String(safeValue);
  shiftReadout.value = String(safeValue);
  shiftReadout.textContent = String(safeValue);

  ['a', 'b', 'c'].forEach((id, index) => {
    $(`#preview-${id}`).textContent = Ciphers.shiftChar(String.fromCharCode(65 + index), safeValue);
  });
  animateShiftPreview();
}

function revealResult() {
  resultTerminal.classList.remove('has-result');
  void resultTerminal.offsetWidth;
  resultTerminal.classList.add('has-result');
}

function showValidationError() {
  const validation = getValidation();
  updateProcessState(true);

  if (validation.field === 'key') {
    keyError.textContent = 'KEY ERROR // Enter at least one letter.';
    keyInput.focus();
  } else if (validation.field === 'vigenere-key') {
    vigenereKeyError.textContent = 'KEY ERROR // Enter at least one letter.';
    vigenereKey.focus();
  } else if (validation.field === 'bifid-key') {
    bifidKeyError.textContent = 'KEY ERROR // Enter at least one letter.';
    bifidKey.focus();
  } else if (validation.field === 'message') {
    messageInput.focus();
  }
}

async function processMessage() {
  if (processing) return;
  const validation = getValidation();
  if (!validation.valid) {
    showValidationError();
    return;
  }

  const text = messageInput.value;
  const version = operationVersion;
  processing = true;
  processButton.disabled = true;
  processButton.setAttribute('aria-disabled', 'true');
  keyError.textContent = '';
  keyInput.setAttribute('aria-invalid', 'false');

  try {
    const response = await window.SecurityAPI.request('/api/cipher', { method: 'POST', body: {
      text, cipher: state.cipher, mode: state.mode, shift: Number(shiftSlider.value),
      key: { playfair: keyInput.value, vigenere: vigenereKey.value, bifid: bifidKey.value }[state.cipher],
      period: Number(bifidPeriod.value)
    } });
    if (version !== operationVersion) return;
    resultOutput.value = response.result;
    window.SecurityAPI.user.cipherRestrictedUntil = response.cipherRestrictedUntil;
    clearTimeout(restrictionTimer);
    const paused = response.cipherRestrictedUntil > Date.now();
    if (paused) restrictionTimer = setTimeout(updateProcessState, response.cipherRestrictedUntil - Date.now() + 100);
    notice.textContent = paused ? 'Operation complete. Further cipher operations are paused for one minute after unusual activity. An administrator has been notified.' : 'OPERATION COMPLETE // Activity recorded. Messages and secret keys were excluded from logs.';

    copyButton.disabled = !resultOutput.value;
    notice.classList.remove('warning');
    notice.classList.add('success');
    formMessage.classList.remove('error');
    formMessage.textContent = 'OPERATION COMPLETE // Output ready to copy.';
    animateActionCompletion();
    revealResult();

    if (window.matchMedia('(max-width: 767px)').matches) {
      $('.result-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (error) {
    if (version !== operationVersion) return;
    resultOutput.value = '';
    copyButton.disabled = true;
    notice.textContent = error.message;
    notice.classList.remove('success');
    notice.classList.add('warning');
    formMessage.textContent = 'Operation failed. Review the message above before trying again.';
    formMessage.classList.add('error');
  } finally {
    processing = false;
    processButton.disabled = !getValidation().valid;
    processButton.setAttribute('aria-disabled', String(processButton.disabled));
  }
}

function refreshAfterInput() {
  operationVersion += 1;
  if (resultOutput.value) clearResult();
  updateProcessState();
}

document.querySelectorAll('.tab').forEach(button => {
  button.addEventListener('click', () => {
    if (state.cipher === button.dataset.cipher) return;
    state.cipher = button.dataset.cipher;
    clearResult();
    keyError.textContent = '';
    keyInput.setAttribute('aria-invalid', 'false');
    renderInterface();
    animateInterfaceChange();
  });

  button.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll('.tab')];
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    const nextTab = tabs[(tabs.indexOf(button) + offset + tabs.length) % tabs.length];
    nextTab.click();
    nextTab.focus();
  });
});

document.querySelectorAll('.mode').forEach(button => {
  button.addEventListener('click', () => {
    if (state.mode === button.dataset.mode) return;
    state.mode = button.dataset.mode;
    clearResult();
    renderInterface();
    animateInterfaceChange();
  });
});

messageInput.addEventListener('input', () => {
  $('#count').textContent = messageInput.value.length.toLocaleString();
  refreshAfterInput();
});

keyInput.addEventListener('input', () => {
  const lettersOnly = keyInput.value.toUpperCase().replace(/[^A-Z]/g, '');
  if (lettersOnly !== keyInput.value) keyInput.value = lettersOnly;
  renderGrid();
  keyError.textContent = '';
  keyInput.setAttribute('aria-invalid', 'false');
  refreshAfterInput();
});

[vigenereKey, bifidKey].forEach(input => input.addEventListener('input', () => {
  input.value = input.value.toUpperCase().replace(/[^A-Z]/g, '');
  vigenereKeyError.textContent = '';
  bifidKeyError.textContent = '';
  if (input === bifidKey) renderBifidGrid();
  refreshAfterInput();
}));

bifidPeriod.addEventListener('input', () => {
  bifidPeriod.value = String(Math.min(50, Math.max(1, Number.parseInt(bifidPeriod.value, 10) || 1)));
  refreshAfterInput();
  setDefaultNotice();
});

shiftSlider.addEventListener('input', event => {
  updateShift(event.target.value);
  refreshAfterInput();
  if (!resultOutput.value) setDefaultNotice();
});

shiftNumber.addEventListener('input', event => {
  updateShift(event.target.value);
  refreshAfterInput();
  if (!resultOutput.value) setDefaultNotice();
});

processButton.addEventListener('click', processMessage);

$('#clear').addEventListener('click', () => {
  messageInput.value = '';
  $('#count').textContent = '0';
  keyError.textContent = '';
  clearResult();
  updateProcessState();
  messageInput.focus();
});

$('#example').addEventListener('click', () => {
  const decrypting = state.mode === 'decrypt';

  if (state.cipher === 'caesar') {
    messageInput.value = decrypting ? 'Khoor, Zruog!' : 'Hello, World!';
    updateShift(3);
  } else if (state.cipher === 'playfair') {
    keyInput.value = 'PLAYFAIR';
    messageInput.value = decrypting ? 'KG YV RV' : 'HELLO';
    renderGrid();
  } else if (state.cipher === 'vigenere') {
    vigenereKey.value = 'LEMON';
    messageInput.value = decrypting ? 'Lxfopv ef Rnhr!' : 'Attack at Dawn!';
  } else {
    bifidKey.value = 'FORTIFICATION';
    bifidPeriod.value = '5';
    messageInput.value = decrypting ? Ciphers.bifidEncrypt('DEFENDTHEEAST', bifidKey.value, 5) : 'DEFEND THE EAST';
    renderBifidGrid();
  }

  $('#count').textContent = messageInput.value.length.toLocaleString();
  keyError.textContent = '';
  clearResult();
  updateProcessState();
  notice.textContent = 'DEMO LOADED // Execute the operation to view output.';
});

copyButton.addEventListener('click', async () => {
  if (!resultOutput.value) return;

  try {
    await navigator.clipboard.writeText(resultOutput.value);
  } catch {
    resultOutput.focus();
    resultOutput.select();
    document.execCommand('copy');
  }

  window.clearTimeout(copyResetTimer);
  copyLabel.textContent = 'Copied!';
  copyButton.classList.remove('copied');
  void copyButton.offsetWidth;
  copyButton.classList.add('copied');
  notice.textContent = 'COPY COMPLETE // Output copied to clipboard.';
  notice.classList.remove('warning');
  notice.classList.add('success');
  copyResetTimer = window.setTimeout(() => {
    copyLabel.textContent = 'Copy';
    copyButton.classList.remove('copied');
  }, 2000);
});

document.addEventListener('keydown', event => {
  if (!window.SecurityAPI.user) return;
  if (!$('#auth-modal').classList.contains('hidden')) return;
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    processMessage();
  }
});

window.addEventListener('auth-change', () => {
  if (!window.SecurityAPI.user) {
    messageInput.value = '';
    keyInput.value = '';
    vigenereKey.value = '';
    bifidKey.value = '';
    renderGrid();
    renderBifidGrid();
  }
  clearResult();
  updateProcessState();
});

renderGrid();
renderBifidGrid();
updateShift(shiftSlider.value);
renderInterface();
