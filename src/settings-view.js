import { LitElement, html } from 'lit';
import { api } from './api.js';
import './lib/ui/s-button.js';

class SettingsView extends LitElement {
  static properties = {
    me: { type: Object },
    _serverSettings: { state: true }, _devices: { state: true }, _currentDID: { state: true },
    _bots: { state: true }, _newBotUser: { state: true }, _newBotDisplay: { state: true },
    _revealedToken: { state: true }, _botError: { state: true },
    _confirmingRegen: { state: true }, _confirmingDel: { state: true }, _botActionErr: { state: true },
    _confirmingDevice: { state: true }, _revokeErr: { state: true },
    _oldPw: { state: true }, _newPw: { state: true }, _newPw2: { state: true },
    _pwBusy: { state: true }, _pwError: { state: true }, _pwOk: { state: true },
    _theme: { state: true }, _fontSize: { state: true }, _clientVersion: { state: true },
  };

  constructor() {
    super();
    this.me = {};
    this._devices = []; this._bots = [];
    this._newBotUser = ''; this._newBotDisplay = ''; this._revealedToken = null;
    this._botError = ''; this._confirmingRegen = null; this._confirmingDel = null; this._botActionErr = '';
    this._confirmingDevice = null; this._revokeErr = '';
    this._oldPw = ''; this._newPw = ''; this._newPw2 = ''; this._pwBusy = false; this._pwError = ''; this._pwOk = false;
    this._theme = localStorage.getItem('theme') || 'system';
    this._fontSize = localStorage.getItem('fontSize') || 'md';
    this._clientVersion = {};
  }

  connectedCallback() { super.connectedCallback(); this._load(); }
  createRenderRoot() { return this; }

  async _load() {
    try { this._serverSettings = await api.getServerSettings(); } catch {}
    try { this._clientVersion = await api.getClientVersion(); } catch {}
    try { this._currentDID = await api.currentDeviceID(); } catch {}
    await this._refreshDevices();
    await this._refreshBots();
  }
  async _refreshDevices() { try { this._devices = await api.listMyDevices(); } catch {} }
  async _refreshBots() { try { this._bots = await api.listBots(); } catch {} }

  render() {
    return html`
      <style>
        settings-view { display: flex; flex-direction: column; flex: 1; min-height: 0; background: #f0f2f5; color: #000; font: 14px system-ui; }
        .hdr { display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: #fff; border-bottom: 1px solid #e0e0e0; flex-shrink: 0; }
        .hdr .back { width: 34px; height: 34px; border: none; background: none; cursor: pointer; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; color: #000; }
        .hdr .back:hover { background: rgba(0,0,0,.06); }
        .hdr .title { font-weight: 600; font-size: 16px; }
        .body { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; }
        .card { background: #fff; margin-bottom: 8px; }
        .card-hdr { padding: 12px 16px; font-size: 12px; font-weight: 600; color: #707579; text-transform: uppercase; letter-spacing: .5px; }
        .card-row { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-top: 1px solid #e0e0e0; }
        .card-row .icon { width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0; background: #f0f0f0; }
        .card-row .text { flex: 1; min-width: 0; }
        .card-row .text .main { font-size: 14px; }
        .card-row .text .sub { font-size: 12px; color: #888; margin-top: 2px; }
        .card-row .action { color: #2481cc; font-size: 13px; flex-shrink: 0; background: none; border: none; cursor: pointer; padding: 4px 8px; border-radius: 4px; }
        .card-row .action:hover { background: #f0f0f0; }
        .card-row .action.danger { color: #e23b3b; }
        .card-row .action.danger:hover { background: #ffe0e0; }
        .badge { background: #e8e8e8; color: #707579; font-size: 11px; padding: 1px 8px; border-radius: 10px; margin-left: 6px; }
        .badge.current { background: #dceeff; color: #2b86d9; }
        .token-box { background: #fffbeb; border: 1px solid #f59e0b; border-radius: 8px; padding: 12px; margin: 12px 16px; }
        .token { font-family: monospace; font-size: 12px; background: #fff; border: 1px solid #ddd; border-radius: 4px; padding: 8px; word-break: break-all; margin: 8px 0; }
        .input-row { display: flex; flex-direction: column; gap: 8px; padding: 12px 16px; border-top: 1px solid #e0e0e0; }
        .input-sm { padding: 8px 12px; border-radius: 6px; border: 1px solid #ddd; font-size: 14px; background: #fff; font: inherit; }
        .input-sm:focus { border-color: #4a9eff; outline: none; }
        .err { color: #e23b3b; font-size: 13px; padding: 8px 16px; }
        .ok { color: #16a34a; font-size: 13px; padding: 8px 16px; }
        .btn-row { display: flex; gap: 8px; padding: 8px 16px; border-top: 1px solid #e0e0e0; }
        .btn-sm { padding: 6px 14px; border-radius: 6px; border: 1px solid #ddd; background: #fff; cursor: pointer; font: 13px system-ui; }
        .btn-sm:hover { background: #f5f5f5; }
        .btn-sm.active { background: #4a9eff; color: #fff; border-color: #4a9eff; }
        .btn-sm.danger { color: #e23b3b; border-color: #e23b3b; }
        .btn-sm.danger:hover { background: #ffe0e0; }
        .chip-row { display: flex; gap: 4px; }
      </style>
      <div class="hdr">
        <button class="back" @click=${this._close}>✕</button>
        <span class="title">Настройки</span>
      </div>
      <div class="body">
        <!-- Profile -->
        <div class="card">
          <div class="card-hdr">Профиль</div>
          <div class="card-row">
            <div class="icon">👤</div>
            <div class="text"><div class="main">${this.me.username}</div><div class="sub">ID: ${(this.me.id || '').slice(0, 12)}…</div></div>
          </div>
        </div>

        <!-- Password -->
        <div class="card">
          <div class="card-hdr">Сменить пароль</div>
          <div class="input-row">
            <input class="input-sm" type="password" placeholder="Текущий пароль" .value=${this._oldPw} @input=${e => this._oldPw = e.target.value} />
            <input class="input-sm" type="password" placeholder="Новый пароль (минимум 8 символов)" .value=${this._newPw} @input=${e => this._newPw = e.target.value} />
            <input class="input-sm" type="password" placeholder="Повторите новый пароль" .value=${this._newPw2} @input=${e => this._newPw2 = e.target.value} />
          </div>
          <div class="btn-row">
            <button class="btn-sm active" ?disabled=${this._pwBusy || !this._oldPw || !this._newPw} @click=${this._changePassword}>${this._pwBusy ? 'Меняем…' : 'Сменить пароль'}</button>
          </div>
          ${this._pwError ? html`<div class="err">${this._pwError}</div>` : ''}
          ${this._pwOk ? html`<div class="ok">Пароль изменён. Остальные устройства отключены.</div>` : ''}
        </div>

        <!-- Devices -->
        <div class="card">
          <div class="card-hdr">Активные устройства · ${this._devices.length}</div>
          ${this._devices.map(d => html`
            <div class="card-row">
              <div class="icon">${d.platform === 'ios' ? '📱' : d.platform === 'web' ? '💻' : '🖥'}</div>
              <div class="text">
                <div class="main">${d.name || 'Без имени'} ${d.id === this._currentDID ? html`<span class="badge current">текущее</span>` : ''}</div>
                <div class="sub">${d.platform || 'unknown'} · ${this._fmtDate(d.created_at)}</div>
              </div>
              <button class="action ${this._confirmingDevice === d.id ? 'danger' : ''}" @click=${() => this._revoke(d)}>
                ${this._confirmingDevice === d.id ? 'Точно?' : d.id === this._currentDID ? 'Выйти' : 'Отключить'}
              </button>
            </div>
          `)}
          ${this._revokeErr ? html`<div class="err">${this._revokeErr}</div>` : ''}
        </div>

        <!-- Bots -->
        <div class="card">
          <div class="card-hdr">Мои боты · ${this._bots.length}</div>
          ${this._revealedToken ? html`
            <div class="token-box">
              <div style="font-weight:600;margin-bottom:4px">Токен для ${this._revealedToken.username}</div>
              <div class="token">${this._revealedToken.token}</div>
              <div style="font-size:12px;color:#888;margin-bottom:8px">Сохрани сейчас — повторно показан не будет.</div>
              <div style="display:flex;gap:8px">
                <button class="btn-sm" @click=${this._copyToken}>Скопировать</button>
                <button class="btn-sm" @click=${() => this._revealedToken = null}>Закрыть</button>
              </div>
            </div>
          ` : ''}
          <div class="input-row">
            <input class="input-sm" placeholder="username (a-z, 0-9, _)" .value=${this._newBotUser} @input=${e => this._newBotUser = e.target.value} />
            <input class="input-sm" placeholder="Отображаемое имя (необязательно)" .value=${this._newBotDisplay} @input=${e => this._newBotDisplay = e.target.value} />
          </div>
          <div class="btn-row">
            <button class="btn-sm active" ?disabled=${!this._newBotUser.trim()} @click=${this._createBot}>Создать бота</button>
          </div>
          ${this._botError ? html`<div class="err">${this._botError}</div>` : ''}
          ${this._bots.map(b => html`
            <div class="card-row">
              <div class="icon">🤖</div>
              <div class="text">
                <div class="main">${b.username}</div>
                ${b.display_name ? html`<div class="sub">${b.display_name}</div>` : ''}
              </div>
              <button class="action ${this._confirmingRegen === b.id ? 'danger' : ''}" @click=${() => this._regenBot(b)}>${this._confirmingRegen === b.id ? 'Точно?' : 'Новый токен'}</button>
              <button class="action ${this._confirmingDel === b.id ? 'danger' : ''}" @click=${() => this._delBot(b)}>${this._confirmingDel === b.id ? 'Точно?' : 'Удалить'}</button>
            </div>
          `)}
          ${this._botActionErr ? html`<div class="err">${this._botActionErr}</div>` : ''}
        </div>

        <!-- Appearance -->
        <div class="card">
          <div class="card-hdr">Внешний вид</div>
          <div class="card-row">
            <div class="text"><div class="main">Тема</div></div>
            <div class="chip-row">
              ${['system','light','dark'].map(t => html`<button class="btn-sm ${this._theme === t ? 'active' : ''}" @click=${() => this._setTheme(t)}>${t === 'system' ? 'Системная' : t === 'light' ? 'Светлая' : 'Тёмная'}</button>`)}
            </div>
          </div>
          <div class="card-row">
            <div class="text"><div class="main">Размер текста</div></div>
            <div class="chip-row">
              ${['sm','md','lg'].map(f => html`<button class="btn-sm ${this._fontSize === f ? 'active' : ''}" @click=${() => this._setFont(f)}>${f === 'sm' ? 'Мелкий' : f === 'md' ? 'Средний' : 'Крупный'}</button>`)}
            </div>
          </div>
        </div>

        <!-- Server -->
        <div class="card">
          <div class="card-hdr">Сервер</div>
          <div class="card-row"><div class="text"><div class="main">Регистрация</div></div><div class="sub">${this._serverSettings?.allow_registration ? 'Открыта' : 'Закрыта'}</div></div>
          <div class="card-row"><div class="text"><div class="main">Identity backup</div></div><div class="sub">${this._serverSettings?.identity_backup_enabled ? 'Включён' : 'Выключен'}</div></div>
          <div class="card-row"><div class="text"><div class="main">Версия сервера</div></div><div class="sub">${this._serverSettings?.version || '—'}</div></div>
          <div class="card-row"><div class="text"><div class="main">Версия клиента</div></div><div class="sub">${this._clientVersion?.version || '…'}${this._clientVersion?.built ? ' (' + this._clientVersion.built + ')' : ''}</div></div>
        </div>

        <!-- Maintenance -->
        <div class="card" style="margin-top:16px">
          <div class="card-row" @click=${this._clearCache} style="cursor:pointer">
            <div class="icon" style="background:#ffe0e0">🗑</div>
            <div class="text"><div class="main" style="color:#e23b3b">Сбросить локальный кеш</div><div class="sub">Помогает если сообщения перепутались или не расшифровываются</div></div>
          </div>
        </div>
      </div>
    `;
  }

  _close() { this.dispatchEvent(new CustomEvent('settings:close', { bubbles: true, composed: true })); }
  _fmtDate(iso) { return iso ? new Date(iso).toLocaleString() : '—'; }

  async _revoke(d) {
    this._revokeErr = '';
    if (this._confirmingDevice !== d.id) { this._confirmingDevice = d.id; return; }
    this._confirmingDevice = null;
    try {
      await api.deleteDevice(d.id);
      if (d.id === this._currentDID) { await api.logout(); this.dispatchEvent(new CustomEvent('settings:logout', { bubbles: true, composed: true })); }
      else { await this._refreshDevices(); }
    } catch (e) { this._revokeErr = String(e); }
  }

  async _changePassword() {
    this._pwError = ''; this._pwOk = false;
    if (this._newPw.length < 8) { this._pwError = 'Новый пароль должен быть не короче 8 символов'; return; }
    if (this._newPw !== this._newPw2) { this._pwError = 'Подтверждение не совпадает'; return; }
    this._pwBusy = true;
    try { await api.changePassword(this._oldPw, this._newPw); this._pwOk = true; this._oldPw = ''; this._newPw = ''; this._newPw2 = ''; await this._refreshDevices(); }
    catch (e) { this._pwError = String(e); }
    this._pwBusy = false;
  }

  async _createBot() {
    this._botError = '';
    const u = this._newBotUser.trim(); if (!u) { this._botError = 'Username обязателен'; return; }
    try { const r = await api.createBot(u, this._newBotDisplay.trim()); this._revealedToken = { bot_id: r.id, username: r.username, token: r.token }; this._newBotUser = ''; this._newBotDisplay = ''; await this._refreshBots(); }
    catch (e) { this._botError = String(e); }
  }

  async _regenBot(b) { this._botActionErr = ''; if (this._confirmingRegen !== b.id) { this._confirmingRegen = b.id; return; } this._confirmingRegen = null; try { const r = await api.regenerateBotToken(b.id); this._revealedToken = { bot_id: b.id, username: b.username, token: r.token }; } catch (e) { this._botActionErr = String(e); } }
  async _delBot(b) { this._botActionErr = ''; if (this._confirmingDel !== b.id) { this._confirmingDel = b.id; return; } this._confirmingDel = null; try { await api.deleteBot(b.id); await this._refreshBots(); } catch (e) { this._botActionErr = String(e); } }
  async _copyToken() { if (!this._revealedToken) return; try { await navigator.clipboard.writeText(this._revealedToken.token); } catch {} }

  _setTheme(t) { this._theme = t; localStorage.setItem('theme', t); const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches); document.documentElement.classList.toggle('dark', dark); }
  _setFont(f) { this._fontSize = f; localStorage.setItem('fontSize', f); document.documentElement.style.fontSize = ({ sm: '13px', md: '14px', lg: '16px' })[f] || '14px'; }

  async _clearCache() {
    try { const { clearAllCache } = await import('./cache.js'); await clearAllCache(); window.location.reload(); }
    catch (e) { alert('Ошибка: ' + e.message); }
  }
}
customElements.define('settings-view', SettingsView);
