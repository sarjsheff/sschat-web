import { LitElement, html, css } from 'lit';
import { api } from './api.js';
import { getBase } from './config.js';
import './lib/ui/s-button.js';
import './lib/ui/s-input.js';

class LoginView extends LitElement {
  static properties = {
    _url: { state: true }, _username: { state: true }, _password: { state: true },
    _error: { state: true }, _busy: { state: true },
  };

  static styles = css`
    :host { display: flex; height: 100%; align-items: center; justify-content: center; background: #f0f0f0; }
    .login-card { width: 360px; padding: 24px; background: #fff; border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,.1); }
    .flex-col { display: flex; flex-direction: column; }
    .space-y-4 > * + * { margin-top: 16px; }
    .text-sm { font-size: 13px; }
    .text-red { color: #e23b3b; }
    .whitespace-pre-wrap { white-space: pre-wrap; }
    .text-xl { font-size: 20px; }
    .font-semibold { font-weight: 600; }
  `;

  constructor() {
    super();
    this._url = getBase();
    this._username = ''; this._password = ''; this._error = ''; this._busy = false;
  }

  render() {
    return html`
      <div class="login-card">
        <div class="flex-col space-y-4">
          <div class="text-xl font-semibold">SSChat</div>
          <s-input placeholder="URL сервера" .value=${this._url} @s-input=${e => this._url = e.detail}></s-input>
          <s-input placeholder="username" .value=${this._username} @s-input=${e => this._username = e.detail} autofocus></s-input>
          <s-input type="password" placeholder="пароль" .value=${this._password}
            @s-input=${e => this._password = e.detail}
            @s-keydown=${e => e.detail.key === 'Enter' && this._submit()}></s-input>
          <s-button ?disabled=${this._busy} @click=${this._submit}>
            ${this._busy ? 'Вход...' : 'Войти'}
          </s-button>
          ${this._error ? html`<div class="text-sm text-red whitespace-pre-wrap">${this._error}</div>` : ''}
        </div>
      </div>
    `;
  }

  async _submit() {
    if (!this._username || !this._password || this._busy) return;
    this._busy = true; this._error = '';
    try {
      await api.setBaseURL(this._url.trim());
      const resp = await api.login(this._username.trim(), this._password);
      const cid = resp.challenge_id; // только строка, не весь объект
      this.dispatchEvent(new CustomEvent('login:done', { detail: { cid }, bubbles: true, composed: true }));
    } catch (e) { this._error = String(e); this._busy = false; }
  }
}
customElements.define('login-view', LoginView);
