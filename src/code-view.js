import { LitElement, html, css } from 'lit';
import { api } from './api.js';
import './lib/ui/s-button.js';
import './lib/ui/s-input.js';

class CodeView extends LitElement {
  static properties = {
    challengeId: { type: String },
    _code: { state: true }, _error: { state: true }, _busy: { state: true },
  };

  static styles = css`
    :host { display: flex; height: 100%; align-items: center; justify-content: center; background: #f0f0f0; }
    .login-card { width: 360px; padding: 24px; background: #fff; border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,.1); }
    .flex-col { display: flex; flex-direction: column; }
    .space-y-4 > * + * { margin-top: 16px; }
    .text-sm { font-size: 13px; }
    .text-xs { font-size: 11px; }
    .text-red { color: #e23b3b; }
    .text-gray { color: #888; }
    .text-center { text-align: center; }
    .whitespace-pre-wrap { white-space: pre-wrap; }
    .text-xl { font-size: 20px; }
    .font-semibold { font-weight: 600; }
  `;

  constructor() {
    super();
    this.challengeId = '';
    this._code = ''; this._error = ''; this._busy = false;
  }

  render() {
    return html`
      <div class="login-card">
        <div class="flex-col space-y-4">
          <div class="text-xl font-semibold">Код подтверждения</div>
          <div class="text-sm text-gray">Код в stdout сервера</div>
          <s-input placeholder="6 цифр" .value=${this._code} @s-input=${e => this._code = e.detail}
            maxlength="6" autofocus ?disabled=${this._busy}
            @s-keydown=${e => e.detail.key === 'Enter' && this._submit()}>
          </s-input>
          <s-button ?disabled=${this._busy} @click=${this._submit}>
            ${this._busy ? 'Проверка...' : 'Подтвердить'}
          </s-button>
          <s-button variant="ghost" ?disabled=${this._busy} @click=${this._cancel}>Отмена</s-button>
          ${this._error ? html`<div class="text-sm text-red whitespace-pre-wrap">${this._error}</div>` : ''}
          ${this._busy ? html`<div class="text-xs text-center text-gray">Восстановление identity...</div>` : ''}
        </div>
      </div>
    `;
  }

  async _submit() {
    if (!this._code || this._busy) return;
    this._busy = true; this._error = '';
    try {
      await api.submitCode(this.challengeId, this._code.trim());
      this.dispatchEvent(new CustomEvent('code:ok', { bubbles: true, composed: true }));
    } catch (e) { this._error = String(e); this._busy = false; }
  }

  // Серверного отзыва challenge нет — просто возвращаемся на экран входа,
  // код протухнет сам.
  _cancel() {
    this.dispatchEvent(new CustomEvent('code:cancel', { bubbles: true, composed: true }));
  }
}
customElements.define('code-view', CodeView);
