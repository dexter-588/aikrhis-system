'use strict';
window.SecurityAPI = {
  user: null,
  csrfToken: null,
  setSession(data) {
    this.user = data.user || null;
    this.csrfToken = data.csrfToken || null;
    window.dispatchEvent(new CustomEvent('auth-change', { detail: this.user }));
  },
  async request(url, options = {}) {
    const headers = { ...options.headers };
    if (options.body) headers['Content-Type'] = 'application/json';
    if (this.csrfToken) headers['X-CSRF-Token'] = this.csrfToken;
    const response = await fetch(url, { credentials: 'same-origin', ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401 && !url.startsWith('/api/auth/')) this.setSession({});
      throw new Error(data.error || 'Request failed.');
    }
    return data;
  },
  async refresh() { const session = await this.request('/api/session'); this.setSession(session); return session; }
};
