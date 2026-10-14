'use strict';
(function initializeSecurityCenter() {
  const api = window.SecurityAPI;
  const $ = selector => document.querySelector(selector);
  const titles = { dashboard: 'Dashboard', users: 'User accounts', alerts: 'Security alerts', reports: 'Audit reports', monitor: 'AI monitoring', account: 'My account', activity: 'My activity' };
  let page = 1;
  let hasMore = false;
  let refreshTimer;
  function message(text, error = false) { $('#center-message').textContent = text; $('#center-message').classList.toggle('error', error); }
  function date(value) { return value ? new Date(value).toLocaleString() : '—'; }
  function button(label, action) {
    const element = document.createElement('button');
    element.type = 'button'; element.textContent = label;
    element.addEventListener('click', async () => {
      element.disabled = true;
      try { await action(); } catch (error) { message(error.message, true); }
      finally { element.disabled = false; }
    });
    return element;
  }
  function table(target, columns, rows) {
    const container = $(target);
    container.replaceChildren();
    if (!rows.length) { const empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = 'No records to display.'; container.append(empty); return; }
    const element = document.createElement('table');
    const head = element.createTHead().insertRow();
    for (const column of columns) { const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = column.title; head.append(cell); }
    const body = element.createTBody();
    for (const row of rows) {
      const tr = body.insertRow();
      for (const column of columns) {
        const cell = tr.insertCell(); const value = column.value(row);
        if (value instanceof HTMLElement) cell.append(value); else cell.textContent = String(value ?? '—');
      }
    }
    container.append(element);
  }
  const activityColumns = [
    { title: 'Time', value: row => date(row.createdAt) },
    { title: 'Account', value: row => row.actorName },
    { title: 'Action', value: row => row.action },
    { title: 'Outcome', value: row => row.outcome },
    { title: 'Details', value: row => row.message || row.resource || row.cipher || '—' }
  ];
  function selectView(view, focus = false) {
    if (api.user?.role !== 'admin') return;
    if (!titles[view]) view = 'dashboard';
    document.querySelectorAll('[data-admin-view]').forEach(section => section.classList.toggle('hidden', section.dataset.adminView !== view));
    document.querySelectorAll('[data-admin-nav]').forEach(link => {
      const active = link.dataset.adminNav === view;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
    $('#center-title').textContent = titles[view];
    document.title = `Aikrhis // ${titles[view]}`;
    document.body.classList.remove('sidebar-open');
    $('#sidebar-toggle').setAttribute('aria-expanded', 'false');
    if (focus) $('#center-title').focus();
  }
  function renderAccess() {
    const user = api.user;
    const admin = user?.role === 'admin';
    document.body.classList.toggle('admin-mode', admin);
    $('#admin-sidebar').classList.toggle('hidden', !admin);
    $('#sidebar-toggle').classList.toggle('hidden', !admin);
    $('#center-workspace').classList.toggle('hidden', user?.role !== 'user');
    $('#center-logout').classList.toggle('hidden', !user);
    $('#signed-in-content').classList.toggle('hidden', !user);
    $('#admin-content').classList.toggle('hidden', !admin);
    if (!admin) $('#admin-notification').classList.add('hidden');
    $('#sign-in-prompt').classList.toggle('hidden', Boolean(user));
    if (!user) {
      $('#center-title').textContent = 'Sign in to continue';
      clearInterval(refreshTimer); return;
    }
    $('#account-identity').textContent = `${user.name} · ${user.email} · ${user.role}`;
    $('#profile-name').value = user.name;
    $('#admin-identity').textContent = user.name;
    if (admin) selectView(location.hash.slice(1));
    else {
      $('#center-title').textContent = 'Your account & activity';
      document.title = 'Aikrhis // Your account';
      document.querySelectorAll('#signed-in-content [data-admin-view]').forEach(section => section.classList.remove('hidden'));
    }
  }
  async function loadDashboard() {
    const data = await api.request('/api/admin/dashboard');
    $('#dashboard-greeting').textContent = `Welcome back, ${api.user.name}.`;
    $('#dashboard-status').textContent = data.summary.openAlerts ? `${data.summary.openAlerts} open alert${data.summary.openAlerts === 1 ? '' : 's'} awaiting review.` : 'No open security alerts.';
    $('#dashboard-status').classList.toggle('needs-review', data.summary.openAlerts > 0);
    $('#dashboard-updated').textContent = `Last updated: ${new Date().toLocaleTimeString()}. Refreshes every 15 seconds.`;
    table('#dashboard-activity', activityColumns, data.recentActivity || []);
    $('#summary-cards').replaceChildren();
    const labels = { users: 'Total accounts', activeUsers: 'Active accounts', lockedAccounts: 'Locked accounts', openAlerts: 'Open alerts', failedLogins: 'Failed logins', anomalies: 'Detected anomalies' };
    for (const [key, label] of Object.entries(labels)) {
      const card = document.createElement('div'); card.className = 'summary-card';
      const text = document.createElement('span'); text.textContent = label;
      const count = document.createElement('strong'); count.textContent = data.summary[key]; card.append(text, count); $('#summary-cards').append(card);
    }
    $('#model-status').textContent = `${data.monitor.algorithm || 'Activity monitoring'} · ${data.monitor.trees || 0} trees · threshold ${Number(data.monitor.threshold || 0).toFixed(4)}`;
    $('#model-details').textContent = 'The monitor reviews activity patterns. Alerts need human review and are not proof of an attack.';
    $('#model-training').textContent = data.monitor.trainingSource || 'Training details unavailable.';
    table('#ai-assessments', [
      { title: 'Time', value: row => date(row.createdAt) }, { title: 'Account', value: row => row.actorName },
      { title: 'Event', value: row => row.action }, { title: 'Model score', value: row => row.assessment.score.toFixed(4) },
      { title: 'Observed activity', value: row => Object.entries(row.assessment.features).map(([key, value]) => `${key}: ${value}`).join(' · ') }
    ], data.events.filter(event => event.assessment));
    $('#storage-status').textContent = `Database storage: ${data.storage}`;
    $('#unread-count').textContent = data.summary.openAlerts;
    $('#sidebar-alert-count').textContent = data.summary.openAlerts;
    $('#sidebar-alert-count').classList.toggle('hidden', !data.summary.openAlerts);
    $('#admin-notification').classList.toggle('hidden', !data.summary.openAlerts || api.user?.role !== 'admin');
    const notification = `${data.summary.openAlerts} security alert${data.summary.openAlerts === 1 ? '' : 's'} awaiting administrator review.`;
    if ($('#admin-notification-text').textContent !== notification) $('#admin-notification-text').textContent = notification;
    $('#alert-list').replaceChildren();
    if (!data.alerts.length) $('#alert-list').textContent = 'No alerts to display.';
    for (const alert of data.alerts) {
      const item = document.createElement('article'); item.className = `alert-item ${alert.severity === 'high' ? 'high' : ''}`;
      const title = document.createElement('h3'); title.textContent = alert.action;
      const text = document.createElement('p'); text.textContent = alert.message;
      const details = document.createElement('p'); details.className = 'secondary-copy'; details.textContent = `${alert.severity} · ${alert.status} · ${date(alert.createdAt)}`;
      item.append(title, text, details);
      for (const status of ['acknowledged', 'resolved']) if (alert.status !== 'resolved' && status !== alert.status) {
        item.append(button(status === 'resolved' ? 'Resolve' : 'Acknowledge', async () => {
          await api.request(`/api/admin/alerts/${encodeURIComponent(alert._id)}`, { method: 'PATCH', body: { status } });
          await loadDashboard(); message('Alert updated.');
        }));
      }
      $('#alert-list').append(item);
    }
  }
  async function loadUsers() {
    const data = await api.request('/api/admin/users');
    table('#user-list', [
      { title: 'Name', value: row => row.name }, { title: 'Email', value: row => row.email },
      { title: 'Role', value: row => row.role }, { title: 'Verified', value: row => row.emailVerified ? 'Yes' : 'No' },
      { title: 'Status', value: row => !row.active ? 'Inactive' : row.lockedUntil > Date.now() ? 'Locked' : row.cipherRestrictedUntil > Date.now() ? 'Cipher paused' : 'Active' },
      { title: 'Actions', value: row => {
        const actions = document.createElement('div'); actions.className = 'row-actions';
        if (row.id === api.user.id) { actions.textContent = 'Your account'; return actions; }
        const update = async body => { await api.request(`/api/admin/users/${encodeURIComponent(row.id)}`, { method: 'PATCH', body }); await Promise.all([loadUsers(), loadDashboard()]); message('Account updated.'); };
        actions.append(button(row.role === 'admin' ? 'Set as user' : 'Set as admin', () => update({ role: row.role === 'admin' ? 'user' : 'admin' })));
        actions.append(button(row.active ? 'Deactivate' : 'Activate', () => update({ active: !row.active })));
        if (row.lockedUntil > Date.now() || row.cipherRestrictedUntil > Date.now()) actions.append(button('Unlock', () => update({ unlock: true })));
        return actions;
      } }
    ], data.users);
    const selected = $('#log-user').value;
    $('#log-user').replaceChildren(new Option('All users', ''));
    for (const user of data.users) $('#log-user').append(new Option(`${user.name} (${user.email})`, user.id));
    $('#log-user').value = selected;
  }
  function logQuery() {
    const query = new URLSearchParams({ type: $('#log-type').value, page: String(page) });
    for (const [key, selector] of [['user', '#log-user'], ['action', '#log-action'], ['from', '#log-from']]) if ($(selector).value) query.set(key, $(selector).value);
    return query;
  }
  async function loadLogs() {
    const data = await api.request(`/api/admin/logs?${logQuery()}`);
    table('#audit-table', activityColumns, data.rows);
    hasMore = data.hasMore;
    $('#page-label').textContent = `Page ${page}`;
    $('#previous-page').disabled = page <= 1;
    $('#next-page').disabled = !hasMore;
  }
  async function loadActivity() { const data = await api.request('/api/activity'); table('#own-activity', activityColumns, data.rows); }
  async function logout() {
    try { await api.request('/api/auth/logout', { method: 'POST', body: {} }); api.setSession({}); location.replace('/'); }
    catch (error) { message(error.message, true); }
  }
  $('#center-logout').addEventListener('click', logout);
  $('#sidebar-logout').addEventListener('click', logout);
  $('#sidebar-toggle').addEventListener('click', () => {
    const open = document.body.classList.toggle('sidebar-open'); $('#sidebar-toggle').setAttribute('aria-expanded', String(open));
  });
  document.querySelectorAll('[data-admin-nav]').forEach(link => link.addEventListener('click', event => {
    event.preventDefault(); const view = link.dataset.adminNav;
    history.replaceState(null, '', `#${view}`); selectView(view, true);
    message('');
    if (view === 'reports') loadLogs().catch(error => message(error.message, true));
    if (view === 'activity') loadActivity().catch(error => message(error.message, true));
  }));
  document.querySelectorAll('[data-dashboard-view]').forEach(button => button.addEventListener('click', () => {
    const view = button.dataset.dashboardView;
    history.replaceState(null, '', `#${view}`); selectView(view, true); message('');
    if (view === 'reports') loadLogs().catch(error => message(error.message, true));
  }));
  window.addEventListener('hashchange', () => selectView(location.hash.slice(1)));
  window.addEventListener('auth-change', renderAccess);
  $('#refresh-dashboard').addEventListener('click', () => Promise.all([loadDashboard(), loadUsers()]).catch(error => message(error.message, true)));
  $('#log-filters').addEventListener('submit', event => { event.preventDefault(); page = 1; loadLogs().catch(error => message(error.message, true)); });
  $('#previous-page').addEventListener('click', () => { if (page > 1) { page--; loadLogs().catch(error => message(error.message, true)); } });
  $('#next-page').addEventListener('click', () => { if (hasMore) { page++; loadLogs().catch(error => message(error.message, true)); } });
  $('#export-report').addEventListener('click', async () => {
    try {
      const query = logQuery(); query.set('export', 'csv');
      const response = await fetch(`/api/admin/logs?${query}`, { credentials: 'same-origin' });
      if (!response.ok) { const data = await response.json(); if (response.status === 401) api.setSession({}); throw new Error(data.error || 'Export failed.'); }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = 'aikrhis-security-report.csv'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { message(error.message, true); }
  });
  $('#profile-form').addEventListener('submit', async event => {
    event.preventDefault(); const submit = event.currentTarget.querySelector('button'); submit.disabled = true;
    try { const data = await api.request('/api/profile', { method: 'PATCH', body: { name: $('#profile-name').value } }); api.setSession({ user: data.user, csrfToken: api.csrfToken }); message('Profile updated.'); }
    catch (error) { message(error.message, true); } finally { submit.disabled = false; }
  });
  $('#password-form').addEventListener('submit', async event => {
    event.preventDefault(); if ($('#new-password').value !== $('#confirm-password').value) return message('Passwords do not match.', true);
    const submit = event.currentTarget.querySelector('button'); submit.disabled = true;
    try { await api.request('/api/password', { method: 'POST', body: { currentPassword: $('#current-password').value, newPassword: $('#new-password').value } }); api.setSession({}); location.replace('/'); }
    catch (error) { message(error.message, true); } finally { submit.disabled = false; }
  });
  renderAccess();
  api.refresh().then(async () => {
    if (!api.user) return;
    await loadActivity();
    if (api.user.role !== 'admin') return;
    await Promise.all([loadDashboard(), loadUsers(), loadLogs()]);
    refreshTimer = setInterval(() => { if (!document.hidden && api.user?.role === 'admin') loadDashboard().catch(error => message(error.message, true)); }, 15000);
  }).catch(error => message(error.message, true));
  window.addEventListener('pagehide', () => clearInterval(refreshTimer));
})();
