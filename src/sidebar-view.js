import { LitElement, html } from 'lit';
import { api, getToken } from './api.js';
import './lib/ui/s-button.js';

class SidebarView extends LitElement {
  static properties = {
    me: { type: Object },
    rooms: { type: Array },
    avatars: { type: Object },
    currentRoomId: { type: String },
    _createOpen: { state: true },
    _newName: { state: true },
  };

  constructor() {
    super();
    this.me = {};
    this.rooms = [];
    this.avatars = {};
    this.currentRoomId = '';
    this._createOpen = false;
    this._newName = '';
  }

  render() {
    return html`
      <aside class="sidebar">
        <header class="sidebar-hdr">
          <span class="hdr-title">${this.me.username || ''}</span>
          <div class="hdr-actions">
            <s-button variant="ghost" size="icon" @click=${() => this._createOpen = !this._createOpen}>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            </s-button>
            <s-button variant="ghost" size="icon" @click=${this._openSettings}>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
            </s-button>
          </div>
        </header>
        ${this._createOpen ? html`
          <div class="create-box">
            <input class="create-input" placeholder="Название комнаты" .value=${this._newName}
              @input=${e => this._newName = e.target.value}
              @keydown=${e => e.key === 'Enter' && this._createRoom()}
            />
            <div class="flex gap-2">
              <s-button size="sm" @click=${this._createRoom} ?disabled=${!this._newName.trim()}>Создать</s-button>
              <s-button size="sm" variant="ghost" @click=${() => { this._createOpen = false; this._newName = ''; }}>Отмена</s-button>
            </div>
          </div>
        ` : ''}
        <div class="room-list">
          ${this.rooms.map(r => this._roomItem(r))}
        </div>
      </aside>
      <style>
        :host { display: flex; flex-direction: column; min-height: 0; width: 100%; }
        .sidebar { display: flex; flex-direction: column; min-height: 0; height: 100%; background: #fff; }
        .sidebar-hdr { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; flex-shrink: 0; }
        .hdr-title { font-weight: 600; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .hdr-actions { display: flex; gap: 2px; flex-shrink: 0; }
        .create-box { padding: 8px 12px; border-bottom: 1px solid #e0e0e0; display: flex; flex-direction: column; gap: 8px; }
        .create-input { height: 34px; border-radius: 6px; border: 1px solid #ccc; padding: 0 8px; font-size: 13px; width: 100%; box-sizing: border-box; outline: none; }
        .create-input:focus { border-color: #4a9eff; }
        .room-list { flex: 1; overflow-y: auto; min-height: 0; }
        .room-item { display: flex; align-items: center; gap: 10px; width: 100%; box-sizing: border-box; border: none; background: none; cursor: pointer; padding: 9px 12px; text-align: left; border-radius: 0; min-width: 0; overflow: hidden; }
        .room-item:hover { background: #f2f2f2; }
        .room-item.active { background: #3390ec; color: #fff; }
        .room-item.active .room-lastmsg { color: rgba(255,255,255,.7); }
        .room-item.active .room-time { color: rgba(255,255,255,.7); }
        .room-avatar { width: 54px; height: 54px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
        .room-avatar-pl { width: 54px; height: 54px; border-radius: 50%; background: linear-gradient(135deg, #6ec9cb, #65aadd); display: flex; align-items: center; justify-content: center; font-size: 22px; color: #fff; flex-shrink: 0; font-weight: 500; }
        .room-info { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
        .room-top { display: flex; align-items: baseline; gap: 4px; min-width: 0; }
        .room-name { font-weight: 500; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1; color: #000; }
        .room-time { font-size: 11px; color: #999; flex-shrink: 0; margin-left: auto; }
        .room-bottom { display: flex; align-items: center; gap: 4px; margin-top: 2px; min-width: 0; }
        .room-lastmsg { font-size: 13px; color: #888; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
        .mute-icon { font-size: 13px; flex-shrink: 0; opacity: .6; }
        .unread-badge { background: #4a9eff; color: #fff; font-size: 11px; font-weight: 500; min-width: 20px; height: 20px; line-height: 20px; padding: 0 5px; border-radius: 10px; text-align: center; flex-shrink: 0; }
      </style>
    `;
  }

  _roomItem(r) {
    const avatar = this.avatars[r.id]
      ? html`<img class="room-avatar" src=${this.avatars[r.id]} alt="" />`
      : html`<div class="room-avatar-pl">${r.name.charAt(0).toUpperCase()}</div>`;

    const time = r.last_message?.created_at
      ? this._fmtTime(r.last_message.created_at)
      : '';

    const preview = this._lastMsgPreview(r);

    return html`
      <button class="room-item ${r.id === this.currentRoomId ? 'active' : ''}"
        @click=${() => this._open(r)}>
        ${avatar}
        <div class="room-info">
          <div class="room-top">
            <span class="room-name">${r.name}</span>
            ${time ? html`<span class="room-time">${time}</span>` : ''}
          </div>
          <div class="room-bottom">
            <span class="room-lastmsg">${preview}</span>
            ${r.muted ? html`<span class="mute-icon">🔇</span>` : ''}
            ${r.unread_count > 0 ? html`<span class="unread-badge">${r.unread_count}</span>` : ''}
          </div>
        </div>
      </button>
    `;
  }

  _lastMsgPreview(r) {
    const m = r.last_message;
    if (!m) return '';
    const body = m.body || '';
    if (body.startsWith('{')) {
      try {
        const p = JSON.parse(body);
        if (p.v === 1) return 'Новое сообщение';
        if (p.c) return p.c;
      } catch {}
    }
    return body.slice(0, 80);
  }

  _fmtTime(iso) {
    const d = new Date(iso);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.floor((today - msgDay) / 86400000);

    if (diffDays === 0) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Вчера';
    } else if (diffDays < 7) {
      const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
      return days[d.getDay()];
    } else {
      return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
    }
  }

  _open(r) {
    this.dispatchEvent(new CustomEvent('sidebar:open-room', { detail: r, bubbles: true, composed: true }));
  }

  _openSettings() {
    this.dispatchEvent(new CustomEvent('sidebar:open-settings', { bubbles: true, composed: true }));
  }

  async _createRoom() {
    const name = this._newName.trim();
    if (!name) return;
    try {
      const room = await api.createRoom(name);
      this._newName = ''; this._createOpen = false;
      this.dispatchEvent(new CustomEvent('sidebar:room-created', { detail: room, bubbles: true, composed: true }));
    } catch (e) { alert(e); }
  }

  createRenderRoot() { return this; }
}
customElements.define('sidebar-view', SidebarView);
