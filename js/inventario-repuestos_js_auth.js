const Auth = {
  token: localStorage.getItem('inventario_auth_token') || '',
  user: null,

  headers() { return this.token ? { Authorization: `Bearer ${this.token}` } : {}; },

  async request(path, options = {}) {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...this.headers(), ...(options.headers || {}) }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'No se pudo completar la operación');
    return body;
  },

  async requireSession() {
    API.authHeaders = () => this.headers();
    if (this.token) {
      try {
        this.user = (await this.request('/auth/me')).user;
        return this.user;
      } catch (_) { this.logout(false); }
    }
    const status = await this.request('/auth/status');
    showAuthScreen(status.needsSetup ? 'setup' : 'login');
    return new Promise((resolve) => { window.__authResolved = resolve; });
  },

  setSession(data) {
    this.token = data.token;
    this.user = data.user;
    localStorage.setItem('inventario_auth_token', this.token);
    hideAuthScreen();
    if (window.__authResolved) { window.__authResolved(this.user); window.__authResolved = null; }
  },

  logout(reload = true) {
    this.token = ''; this.user = null; localStorage.removeItem('inventario_auth_token');
    if (reload) window.location.reload();
  }
};

function showAuthScreen(mode) {
  const overlay = document.getElementById('auth-overlay');
  overlay.classList.remove('hidden');
  document.getElementById('auth-login-form').classList.toggle('hidden', mode !== 'login');
  document.getElementById('auth-setup-form').classList.toggle('hidden', mode !== 'setup');
}

function hideAuthScreen() { document.getElementById('auth-overlay').classList.add('hidden'); }

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('auth-login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = document.getElementById('auth-error'); error.textContent = '';
    try {
      Auth.setSession(await Auth.request('/auth/login', { method: 'POST', body: JSON.stringify({ nombre: document.getElementById('auth-nombre').value.trim(), password: document.getElementById('auth-password').value }) }));
    } catch (err) { error.textContent = err.message; }
  });
  document.getElementById('auth-setup-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = document.getElementById('setup-error'); error.textContent = '';
    const password = document.getElementById('setup-password').value;
    if (password !== document.getElementById('setup-password-confirm').value) { error.textContent = 'Las contraseñas no coinciden'; return; }
    try { Auth.setSession(await Auth.request('/auth/setup', { method: 'POST', body: JSON.stringify({ password }) })); }
    catch (err) { error.textContent = err.message; }
  });
});
