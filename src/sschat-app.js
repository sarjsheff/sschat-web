import { LitElement, html } from 'lit';
import { api, getToken, setIdentity } from './api.js';
import { connectSSE } from './sse.js';
import { loadOrCreateIdentity } from './identity.js';

import './login-view.js';
import './code-view.js';
import './sidebar-view.js';
import './settings-view.js';
import './chat-view.js';
import './room-info.js';

class SSChatApp extends LitElement {
  static properties = {
    _stage: { state: true },  // 'loading' | 'login' | 'code' | 'main'
    _me: { state: true },
    _challengeId: { state: true },
    _rooms: { state: true },
    _avatars: { state: true },
    _sidebarWidth: { state: true },
    _currentRoomId: { state: true },
    _view: { state: true },     // 'chat' | 'room-info' | 'settings'
    _usersById: { state: true },
    _refreshTimer: { state: false },
  };

  constructor() {
    super();
    this._stage = 'loading';
    this._me = null;
    this._challengeId = '';
    this._rooms = [];
    this._avatars = {};
    this._sidebarWidth = parseInt(localStorage.getItem('sidebar-width')) || 280;
    this._currentRoomId = null;
    this._view = 'chat';
    this._usersById = {};
    this._refreshTimer = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._init();
  }

  async _init() {
    const s = await api.getState();
    if (s.authenticated) await this._enterMain(s.me);
    else this._stage = 'login';
  }

  /** Общий вход в основной экран: и для восстановленной сессии, и после ввода кода. */
  async _enterMain(me) {
    this._me = me;
    await this._setupIdentity(this._me?.id);
    connectSSE(getToken());
    this._rooms = await api.listRooms();
    this._cacheRooms();
    await this._loadAvatars();
    this._startListening();
    this._stage = 'main';
    this._tryPublishApnsToken();
  }

  // iOS: публикация APNs-токена на сервер. push.m пишет токен в файл асинхронно
  // после registerForRemoteNotifications — ретраим 30×2с пока не появится.
  // Потерялся при миграции Svelte→Lit (был tryPublishApnsToken в Main.svelte).
  async _tryPublishApnsToken() {
    for (let i = 0; i < 30; i++) {
      try {
        if (await api.publishApnsToken()) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // TODO: восстановление identity из серверного бэкапа требует пароль от
  // пользователя (restoreFromBackup(password, backup) в identity.js) — UI для
  // ввода пока не сделан. До тех пор ключи создаются локально при первом входе;
  // на новом устройстве старые сообщения не расшифруются.
  async _setupIdentity(userId) {
    const id = await loadOrCreateIdentity();
    setIdentity(id.priv, userId || this._me?.id);
  }

  // Здесь только то, что касается всего приложения: список комнат, аватарки,
  // раздача ключей. Ленту эти же события sse:* обновляют сами — chat-view
  // подписан на них напрямую.
  _startListening() {
    if (this._listeners) return; // повторный вход (ре-логин) не должен удваивать подписки

    const redistributeAll = async () => {
      for (const r of this._rooms) { try { await api.redistributeRoomKey(r.id); } catch {} }
    };

    // [цель, событие, обработчик] — один список для подписки и для отписки
    this._listeners = [
      [window, 'sse:message', () => this._refreshRooms()],
      [window, 'sse:room_created', () => this._refreshRoomsNow()],
      [window, 'sse:room_deleted', () => { this._currentRoomId = null; this._view = 'chat'; this._refreshRoomsNow(); }],
      [window, 'sse:hello', () => this._refreshRooms()],
      [window, 'sse:read_state', () => this._refreshRooms()],
      [window, 'sse:device_added', redistributeAll],
      [window, 'sse:device_pub_updated', redistributeAll],
      [window, 'room-info:mute-toggled', () => this._refreshRoomsNow()],
      [window, 'room-info:avatar-changed', (e) => this._refreshAvatar(e.detail?.roomId).then(() => this._refreshRoomsNow())],
      [document, 'visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        api.publishApnsToken().catch(() => {});
        this._refreshRooms(); // вернулись из фона — актуализировать сайдбар
      }],
    ];
    for (const [target, name, fn] of this._listeners) target.addEventListener(name, fn);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    for (const [target, name, fn] of this._listeners || []) target.removeEventListener(name, fn);
    this._listeners = null;
    if (this._refreshTimer) { clearTimeout(this._refreshTimer); this._refreshTimer = null; }
    for (const url of Object.values(this._avatars)) URL.revokeObjectURL(url);
  }

  _refreshRooms() {
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(async () => {
      this._refreshTimer = null;
      this._rooms = await api.listRooms();
      this._cacheRooms();
      await this._loadAvatars();
    }, 500);
  }

  async _refreshRoomsNow() {
    if (this._refreshTimer) { clearTimeout(this._refreshTimer); this._refreshTimer = null; }
    this._rooms = await api.listRooms();
    this._cacheRooms();
    await this._loadAvatars();
  }

  async _cacheRooms() {
    try { const { setCachedRooms } = await import('./cache.js'); await setCachedRooms(this._rooms); } catch {}
  }

  async _loadAvatars() {
    const token = getToken();
    if (!token) return;
    const newAvatars = {};
    // Уже загруженные переносим как есть, недостающие тянем параллельно —
    // последовательный цикл давал по запросу на комнату при каждом refresh.
    const wanted = this._rooms.filter(r => r.has_avatar);
    for (const r of wanted) if (this._avatars[r.id]) newAvatars[r.id] = this._avatars[r.id];
    await Promise.all(wanted.filter(r => !newAvatars[r.id]).map(async (r) => {
      const blob = await this._fetchAvatar(r.id, token);
      if (blob) newAvatars[r.id] = URL.createObjectURL(blob);
    }));
    for (const [id, url] of Object.entries(this._avatars)) {
      if (!newAvatars[id]) URL.revokeObjectURL(url);
    }
    this._avatars = newAvatars;
  }

  async _fetchAvatar(roomId, token) {
    try {
      const resp = await fetch(api.getRoomAvatarUrl(roomId), { headers: { 'Authorization': `Bearer ${token}` } });
      return resp.ok ? await resp.blob() : null;
    } catch { return null; }
  }

  async _refreshAvatar(roomId) {
    const token = getToken();
    if (!token) return;
    if (this._avatars[roomId]) URL.revokeObjectURL(this._avatars[roomId]);
    const blob = await this._fetchAvatar(roomId, token);
    if (blob) {
      this._avatars = { ...this._avatars, [roomId]: URL.createObjectURL(blob) };
    } else {
      const next = { ...this._avatars }; delete next[roomId]; this._avatars = next;
    }
  }

  _onLogin(data) {
    this._challengeId = data.detail.cid;
    this._stage = 'code';
  }

  async _onCodeOK() {
    await this._enterMain(await api.me());
  }

  _onLogout() {
    api.logout();
    this._me = null; this._rooms = []; this._currentRoomId = null;
    this._stage = 'login';
  }

  _openRoom(e) {
    this._currentRoomId = e.detail?.id || e.detail;
    this._view = 'chat';
  }

  _getRoom() { return this._rooms.find(r => r.id === this._currentRoomId) || null; }

  // ── Resize сайдбара (как в Telegram Web) ──
  _startResize(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = this._sidebarWidth;
    const handle = e.target;
    handle.classList.add('active');

    const onMove = (ev) => {
      const w = Math.max(200, Math.min(500, startW + ev.clientX - startX));
      this._sidebarWidth = w;
      localStorage.setItem('sidebar-width', w);
      this.requestUpdate();
    };
    const onUp = () => {
      handle.classList.remove('active');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  render() {
    if (this._stage === 'loading') {
      const v = api.getClientVersion();
      return html`<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;width:100%;gap:12px">
        <img src="/icon-128.png" alt="SSChat" style="width:66.6%;max-width:320px">
        <div style="font-size:12px;color:#999;font-family:system-ui">v${v?.version || '...'}</div>
      </div>`;
    }
    if (this._stage === 'login') return html`<login-view @login:done=${(e) => this._onLogin(e)}></login-view>`;
    if (this._stage === 'code') return html`<code-view challengeId=${this._challengeId}
      @code:ok=${() => this._onCodeOK()} @code:cancel=${() => this._stage = 'login'}></code-view>`;

    // main stage
    const room = this._getRoom();
    const hasRoom = !!room;
    const showSidebar = this._view !== 'settings';
    const sw = this._sidebarWidth;
    return html`
      <div class="root">
        ${showSidebar ? html`
          <div class="sidebar-wrap ${hasRoom ? 'hidden-mobile' : ''}" style="width:${sw}px">
            <sidebar-view .me=${this._me} .rooms=${this._rooms} .avatars=${this._avatars}
              .currentRoomId=${room?.id || ''}
              @sidebar:open-room=${(e) => this._openRoom(e)}
              @sidebar:open-settings=${() => { this._view = 'settings'; this._currentRoomId = null; }}
              @sidebar:room-created=${(e) => { this._rooms = [...this._rooms, e.detail]; this._refreshRoomsNow(); this._openRoom({ detail: e.detail }); }}>
            </sidebar-view>
          </div>
          <div class="resize-handle" @mousedown=${this._startResize}></div>
        ` : ''}
        <section class="chat-area ${this._view} ${!hasRoom && this._view !== 'settings' ? 'hidden-mobile' : ''}">
          ${this._view === 'settings' ? html`
            <settings-view .me=${this._me}
              @settings:close=${() => this._view = 'chat'}
              @settings:logout=${() => this._onLogout()}>
            </settings-view>
          ` : room ? html`
            ${this._view === 'room-info' ? html`
              <room-info token=${getToken()} roomid=${room.id} roomname=${room.name}
                ownerid=${room.owner_id} userid=${this._me?.id} muted=${room.muted || false}
                avatarurl=${this._avatars[room.id] || ''}
                style="flex:1;min-height:0"
                @room-info:close=${() => this._view = 'chat'}
                @room-info:deleted=${() => { this._currentRoomId = null; this._view = 'chat'; }}>
              </room-info>
            ` : html`
              <chat-view token=${getToken()} room=${room.id} roomname=${room.name}
                user=${this._me.id} avatarurl=${this._avatars[room.id] || ''}
                style="flex:1;min-height:0"
                @chat-view:open-info=${() => this._view = 'room-info'}
                @chat-view:back=${() => this._currentRoomId = null}>
              </chat-view>
            `}
          ` : html`<div class="placeholder">Выберите комнату</div>`}
        </section>
      </div>
      <style>
        :host { display: flex; height: 100%; width: 100%; overflow: hidden; }
        .root { display: flex; height: 100%; width: 100%; overflow: hidden; }
        .center { display: flex; height: 100%; align-items: center; justify-content: center; }
        .sidebar-wrap { width: 280px; flex-shrink: 0; min-height: 0; }
        .resize-handle { width: 8px; cursor: col-resize; flex-shrink: 0; margin-left: -4px; z-index: 1; border-right: 1px solid #e0e0e0; }
        .chat-area { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
        .chat-area.settings { background: #f0f2f5; }
        .chat-area:not(.settings) { background: rgb(153,186,146); }
        .placeholder { flex: 1; display: flex; align-items: center; justify-content: center; font-size: 16px; color: #666; }
        /* Mobile: сайдбар и чат не видны одновременно, resize не нужен */
        @media (max-width: 767px) {
          .sidebar-wrap { width: 100% !important; }
          .hidden-mobile { display: none; }
        }
      </style>
    `;
  }

  createRenderRoot() { return this; }
}
customElements.define('sschat-app', SSChatApp);
