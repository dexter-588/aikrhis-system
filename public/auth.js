'use strict';
(function initializeServerAuth() {
  const api = window.SecurityAPI;
  const modal = document.querySelector('#auth-modal');
  const dialog = modal.querySelector('.auth-dialog');
  const loginForm = document.querySelector('#login-form');
  const signupForm = document.querySelector('#signup-form');
  const forgotForm = document.querySelector('#forgot-form');
  const resetForm = document.querySelector('#reset-form');
  const verifyForm = document.querySelector('#verify-form');
  const forms = { login: loginForm, signup: signupForm, forgot: forgotForm, reset: resetForm, verify: verifyForm };
  let linkToken = '';
  let linkPurpose = '';
  let previouslyFocused;
  let closeTimer;

  function renderSession() {
    const user = api.user;
    const isOperator = user?.role === 'user';
    if (user?.role === 'admin' && !linkPurpose && !/#(?:reset-password|verify-email)=/.test(location.hash)) {
      document.querySelector('#user-dashboard').classList.add('hidden');
      location.replace('/security.html');
      return;
    }
    document.querySelector('#guest-home').classList.toggle('hidden', Boolean(user));
    document.querySelector('#user-dashboard').classList.toggle('hidden', !isOperator);
    document.querySelector('#dashboard-title').textContent = user ? `Welcome back, ${user.name}.` : 'Welcome back.';
    document.title = user ? 'Aikrhis // Dashboard' : 'Aikrhis // Cipher Command';
    const pathname = isOperator ? '/dashboard' : '/';
    if (location.pathname !== pathname) history.replaceState(null, '', pathname + location.search + location.hash);
    document.querySelector('#guest-actions').classList.toggle('hidden', Boolean(user));
    document.querySelector('#user-summary').classList.toggle('hidden', !user);
    document.querySelector('#user-name').textContent = user ? `${user.name.split(/\s+/)[0]} // ${user.role}` : '';
    document.querySelector('#user-avatar').textContent = user ? user.name.slice(0, 2).toUpperCase() : 'AI';
    document.querySelector('#security-link').classList.toggle('hidden', !user);
    document.querySelector('#access-status').textContent = user ? user.emailVerified ? 'Session secured // Email verified' : 'Verify your email to execute cipher operations' : 'Sign in to execute cipher operations';
    document.querySelector('#verification-notice').classList.toggle('hidden', !user || user.emailVerified);
  }
  function clearMessages() {
    document.querySelectorAll('.auth-message').forEach(message => { message.textContent = ''; message.classList.remove('success'); });
    document.querySelectorAll('.auth-field input').forEach(input => input.setAttribute('aria-invalid', 'false'));
  }
  function showMessage(id, text, success = false) {
    const target = document.querySelector(id);
    target.textContent = text;
    target.classList.toggle('success', success);
  }
  function setView(view) {
    if (!forms[view]) return;
    Object.entries(forms).forEach(([key, form]) => form.classList.toggle('hidden', key !== view));
    document.querySelectorAll('.auth-tab').forEach(tab => {
      const active = tab.dataset.authView === view;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    clearMessages();
    window.setTimeout(() => forms[view].querySelector('input, button[type="submit"]').focus(), 40);
  }
  function openAuth(view) {
    clearTimeout(closeTimer);
    previouslyFocused = document.activeElement;
    modal.classList.remove('hidden', 'is-closing');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('auth-open');
    setView(view);
  }
  function closeAuth() {
    if (modal.classList.contains('hidden')) return;
    modal.classList.add('is-closing');
    closeTimer = setTimeout(() => {
      modal.classList.add('hidden');
      modal.classList.remove('is-closing');
      modal.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('auth-open');
      if (api.user) document.querySelector('#dashboard-title').focus();
      else if (previouslyFocused?.offsetParent !== null) previouslyFocused?.focus();
    }, 190);
  }
  function strength(password) {
    const level = Number(password.length >= 12) + Number(password.length >= 16) + Number(/[a-z]/.test(password) && /[A-Z]/.test(password)) + Number(/\d/.test(password) && /[^a-zA-Z0-9]/.test(password));
    document.querySelector('#password-strength').dataset.level = String(level);
    document.querySelector('#password-strength-label').textContent = password.length < 12 ? 'Use at least 12 characters. A long, unique passphrase works well.' : ['Add length and variety.', 'Add length and variety.', 'Fair password.', 'Good password.', 'Strong password.'][level];
  }
  async function submit(event, register) {
    event.preventDefault();
    const form = register ? signupForm : loginForm;
    if (form.querySelector('button[type="submit"]').disabled) return;
    clearMessages();
    if (!form.reportValidity()) return;
    if (register && document.querySelector('#signup-password').value !== document.querySelector('#signup-confirm').value) {
      document.querySelector('#signup-confirm').setAttribute('aria-invalid', 'true');
      showMessage('#signup-message', 'Passwords do not match.');
      return;
    }
    const button = form.querySelector('.auth-submit');
    button.disabled = true;
    button.classList.add('is-loading');
    try {
      const prefix = register ? 'signup' : 'login';
      const body = { email: document.querySelector(`#${prefix}-email`).value, password: document.querySelector(`#${prefix}-password`).value };
      if (register) body.name = document.querySelector('#signup-name').value;
      else body.remember = document.querySelector('#remember-session').checked;
      const session = await api.request(`/api/auth/${register ? 'register' : 'login'}`, { method: 'POST', body });
      api.setSession(session);
      form.reset();
      strength('');
      showMessage(`#${prefix}-message`, session.message || 'Access granted. Your session is ready.', true);
      setTimeout(closeAuth, 450);
    } catch (error) { showMessage(register ? '#signup-message' : '#login-message', error.message); }
    finally { button.disabled = false; button.classList.remove('is-loading'); }
  }
  document.querySelector('#open-login').addEventListener('click', () => openAuth('login'));
  document.querySelector('#open-signup').addEventListener('click', () => openAuth('signup'));
  document.querySelectorAll('[data-auth-open]').forEach(button => button.addEventListener('click', () => openAuth(button.dataset.authOpen)));
  document.querySelector('#auth-close').addEventListener('click', closeAuth);
  modal.querySelector('[data-auth-close]').addEventListener('click', closeAuth);
  document.querySelectorAll('[data-auth-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.authView)));
  document.querySelectorAll('.password-toggle').forEach(button => button.addEventListener('click', () => {
    const input = document.querySelector(`#${button.dataset.passwordTarget}`);
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    button.textContent = showing ? 'Show' : 'Hide';
    button.setAttribute('aria-label', `${showing ? 'Show' : 'Hide'} password`);
  }));
  document.querySelector('#signup-password').addEventListener('input', event => strength(event.target.value));
  loginForm.addEventListener('submit', event => submit(event, false));
  signupForm.addEventListener('submit', event => submit(event, true));
  async function submitLinkForm(event, view) {
    event.preventDefault();
    const form = forms[view];
    const button = form.querySelector('button[type="submit"]');
    if (button.disabled) return;
    clearMessages();
    if (!form.reportValidity()) return;
    if (view === 'reset' && document.querySelector('#reset-password').value !== document.querySelector('#reset-confirm').value) {
      showMessage('#reset-message', 'Passwords do not match.');
      document.querySelector('#reset-confirm').focus();
      return;
    }
    if (view !== 'forgot' && (!linkToken || linkPurpose !== view)) {
      showMessage(`#${view}-message`, 'This link is invalid. Open a new link from your email.');
      return;
    }
    button.disabled = true;
    try {
      const endpoint = { forgot: 'forgot-password', reset: 'reset-password', verify: 'verify-email' }[view];
      const body = view === 'forgot' ? { email: document.querySelector('#forgot-email').value } : { token: linkToken };
      if (view === 'reset') body.password = document.querySelector('#reset-password').value;
      const result = await api.request(`/api/auth/${endpoint}`, { method: 'POST', body });
      form.reset();
      if (view === 'forgot') showMessage('#forgot-message', result.message, true);
      else {
        linkToken = '';
        linkPurpose = '';
        await api.refresh();
        setView('login');
        showMessage('#login-message', result.message, true);
      }
    } catch (error) { showMessage(`#${view}-message`, error.message); }
    finally { button.disabled = false; }
  }
  forgotForm.addEventListener('submit', event => submitLinkForm(event, 'forgot'));
  resetForm.addEventListener('submit', event => submitLinkForm(event, 'reset'));
  verifyForm.addEventListener('submit', event => submitLinkForm(event, 'verify'));
  document.querySelector('#resend-verification').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await api.request('/api/auth/resend-verification', { method: 'POST', body: {} });
      showMessage('#verification-message', result.message, true);
    } catch (error) { showMessage('#verification-message', error.message); }
    finally { button.disabled = false; }
  });
  document.querySelector('#logout').addEventListener('click', async () => {
    try { await api.request('/api/auth/logout', { method: 'POST', body: {} }); api.setSession({}); }
    catch (error) { document.querySelector('#access-status').textContent = error.message; }
  });
  window.addEventListener('auth-change', renderSession);
  document.addEventListener('keydown', event => {
    if (modal.classList.contains('hidden')) return;
    if (event.key === 'Escape') { event.preventDefault(); closeAuth(); }
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled)')].filter(element => element.offsetParent !== null);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  strength('');
  renderSession();
  api.refresh().catch(() => { document.querySelector('#access-status').textContent = 'Security service unavailable. Check the server connection.'; }).finally(() => {
    const fragment = new URLSearchParams(location.hash.slice(1));
    const reset = fragment.get('reset-password');
    const verify = fragment.get('verify-email');
    if (reset === null && verify === null) return;
    linkToken = reset ?? verify;
    linkPurpose = reset !== null ? 'reset' : 'verify';
    history.replaceState(null, '', location.pathname + location.search);
    openAuth(linkPurpose);
  });
})();
