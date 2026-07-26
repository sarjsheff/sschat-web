// room-info.js — Web Component <room-info>: настройки комнаты (Telegram Web style).
// Атрибуты: token, roomid, roomname, ownerid, userid, muted. События: room-info:close, room-info:deleted, room-info:mute-toggled.

import { getBase } from './config.js';

/** Resize image file to max W×H, return JPEG as Uint8Array. Keeps aspect ratio. */
async function resizeImage(file, maxW, maxH) {
  const img = await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => { URL.revokeObjectURL(url); resolve(el); };
    el.onerror = reject;
    el.src = url;
  });
  let w = img.width, h = img.height;
  const ratio = Math.min(maxW / w, maxH / h, 1);
  w = Math.round(w * ratio); h = Math.round(h * ratio);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

class RoomInfo extends HTMLElement {
  static get observedAttributes() { return ['token', 'roomid', 'roomname', 'ownerid', 'userid', 'muted', 'avatarurl']; }

  get _root() { return this.shadowRoot || this; }

  constructor() {
    super();
    if (this.attachShadow) { try { this.attachShadow({ mode: 'open' }); } catch {} }
    this._token = ''; this._roomId = ''; this._roomName = ''; this._ownerId = ''; this._userId = ''; this._muted = false; this._avatarUrl = '';
    this.members = []; this.allUsers = []; this.bots = []; this.myBots = [];
    this._memberPicker = false; this._botPicker = false; this._confirmDelete = false;
    this._err = '';
    this.names = {};
  }

  set token(v) { this._token = v; }
  set roomid(v) { this._roomId = v; if (this.isConnected) this._load(); }
  set roomname(v) { this._roomName = v; if (this.isConnected) this._render(); }
  set ownerid(v) { this._ownerId = v; }
  set userid(v) { this._userId = v; }
  set muted(v) { this._muted = v === 'true' || v === true; }
  set avatarurl(v) { this._avatarUrl = v || ''; if (this.isConnected) this._render(); }

  connectedCallback() { this._load(); }
  attributeChangedCallback(name, old, val) {
    if (old === val || val == null) return;
    if (name === 'avatarurl') { this._avatarUrl = val; this._render(); return; }
    if (name === 'muted') { this._muted = val === 'true' || val === true; return; }
    const key = { roomid: '_roomId', roomname: '_roomName', ownerid: '_ownerId', userid: '_userId', token: '_token' }[name];
    if (key) this[key] = val;
    if (name === 'roomid' && this.isConnected) this._load();
  }

  async _api(path, opts = {}) {
    const r = await fetch(getBase() + path, { ...opts, headers: { Authorization: 'Bearer ' + this._token, ...(opts.headers || {}) } });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      let msg = `HTTP ${r.status}`;
      try { const j = JSON.parse(body); if (j.error) msg = j.error; } catch {}
      throw new Error(msg);
    }
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  }

  async _load() {
    // Четыре независимых запроса — параллельно; сбой любого не рушит остальные.
    const load = (path, label) => this._api(path).catch(e => { console.error(label, e); return null; });
    const [members, users, bots, myBots] = await Promise.all([
      load(`/rooms/${this._roomId}/members`, 'members'),
      load('/users', 'users'),
      load(`/rooms/${this._roomId}/bots`, 'roomBots'),
      load('/bots', 'myBots'),
    ]);
    this.members = members || [];
    this.allUsers = users || [];
    this.bots = bots || [];
    this.myBots = myBots || [];
    // Имена подтягиваются фоном — каждое обновляет разметку по готовности
    for (const m of this.members) {
      if (!this.names[m.user_id]) this._resolveName(m.user_id).then(() => this._render());
    }
    this._render();
  }

  _name(uid) { return this.names[uid] || uid?.slice(0, 8) || '—'; }

  async _resolveName(uid) {
    if (this.names[uid]) return this.names[uid];
    try { const u = await this._api(`/users/${uid}`); return (this.names[uid] = u.display_name || u.username || uid.slice(0, 8)); }
    catch { return (this.names[uid] = uid.slice(0, 8)); }
  }

  get _isOwner() { return this._userId === this._ownerId; }
  get _isAdmin() { return this.members.find(m => m.user_id === this._userId)?.role === 'admin'; }
  get _canManage() { return this._isOwner || this._isAdmin; }

  get _availableUsers() { return this.allUsers.filter(u => !this.members.some(m => m.user_id === u.id) && !this.bots.some(b => b.id === u.id)); }
  get _availableBots() { return this.myBots.filter(b => !this.bots.some(rb => rb.id === b.id)); }

  _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  _close() { this.dispatchEvent(new CustomEvent('room-info:close', { bubbles: true, composed: true })); }

  async _addMember(uid) { try { await this._api(`/rooms/${this._roomId}/members/${uid}`, { method: 'POST' }); this.members = (await this._api(`/rooms/${this._roomId}/members`)) || this.members; this._memberPicker = false; this._render(); } catch {} }
  async _removeMember(uid) { try { await this._api(`/rooms/${this._roomId}/members/${uid}`, { method: 'DELETE' }); this.members = (await this._api(`/rooms/${this._roomId}/members`)) || this.members; this._render(); } catch {} }
  async _toggleAdmin(uid) {
    const m = this.members.find(x => x.user_id === uid);
    const newRole = m?.role === 'admin' ? 'member' : 'admin';
    try { await this._api(`/rooms/${this._roomId}/members/${uid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: newRole }) }); this.members = (await this._api(`/rooms/${this._roomId}/members`)) || this.members; this._render(); } catch {}
  }
  async _addBot(id) {
    try { await this._api(`/rooms/${this._roomId}/bots/${id}`, { method: 'POST' }); this._botPicker = false; this.bots = (await this._api(`/rooms/${this._roomId}/bots`)) || this.bots; this._render(); } catch {}
  }
  async _removeBot(id) { try { await this._api(`/rooms/${this._roomId}/bots/${id}`, { method: 'DELETE' }); this.bots = (await this._api(`/rooms/${this._roomId}/bots`)) || this.bots; this._render(); } catch {} }
  async _deleteRoom() {
    if (!this._confirmDelete) { this._confirmDelete = true; this._render(); return; }
    try { await this._api(`/rooms/${this._roomId}`, { method: 'DELETE' }); this.dispatchEvent(new CustomEvent('room-info:deleted', { bubbles: true, composed: true })); }
    catch { this._err = 'Не удалось удалить комнату'; this._render(); }
  }
  async _toggleMute() {
    const muted = !this._muted;
    try { if (muted) await this._api(`/rooms/${this._roomId}/mute`, { method: 'PUT' }); else await this._api(`/rooms/${this._roomId}/mute`, { method: 'DELETE' }); this._muted = muted; this.dispatchEvent(new CustomEvent('room-info:mute-toggled', { detail: { roomId: this._roomId, muted }, bubbles: true, composed: true })); this._render(); } catch {}
  }

  _memberHtml(m) {
    const isOwner = m.role === 'owner', isAdmin = m.role === 'admin';
    const initials = (this._name(m.user_id)).charAt(0).toUpperCase();
    const canAct = this._canManage && m.user_id !== this._userId && m.role !== 'owner';
    return `<div class="member-row">
      <div class="member-avatar">${initials}</div>
      <div class="member-name">${this._esc(this._name(m.user_id))}${isOwner ? ' <span class="role owner">владелец</span>' : isAdmin ? ' <span class="role admin">админ</span>' : ''}</div>
      ${canAct ? `<div class="member-actions">
        <button data-act="toggle-admin" data-id="${m.user_id}">${isAdmin ? '⇩' : '⇧'}</button>
        <button data-act="rm-member" data-id="${m.user_id}" class="rm">✕</button>
      </div>` : ''}
    </div>`;
  }

  _botHtml(b) {
    return `<div class="member-row">
      <div class="member-avatar bot">🤖</div>
      <div class="member-name">${this._esc(b.display_name || b.username || b.id.slice(0, 8))}</div>
      ${(this._isOwner || this._isAdmin) ? `<div class="member-actions"><button data-act="rm-bot" data-id="${b.id}" class="rm">✕</button></div>` : ''}
    </div>`;
  }

  _render() {
    const canManage = this._canManage;
    const isOwner = this._isOwner;
    const memberCount = this.members.length;
    const botCount = this.bots.length;

    const avatarHtml = this._avatarUrl
      ? `<div class="avatar-wrap"><img class="avatar" src="${this._esc(this._avatarUrl)}" alt="" /><label class="avatar-overlay"><input type="file" accept="image/*" hidden data-act="avatar-upload" />📷</label></div>`
      : `<div class="avatar-wrap"><div class="avatar placeholder">${(this._roomName || '?').charAt(0).toUpperCase()}</div><label class="avatar-overlay"><input type="file" accept="image/*" hidden data-act="avatar-upload" />📷</label></div>`;

    this._root.innerHTML = `
      <style>
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; background: #f0f2f5; color: #000; font: 14px system-ui; overflow: hidden; }
        .hdr { display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: #fff; border-bottom: 1px solid #e0e0e0; flex-shrink: 0; }
        .hdr .back { width: 34px; height: 34px; border: none; background: none; cursor: pointer; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; color: #000; }
        .hdr .back:hover { background: rgba(0,0,0,.06); }
        .hdr .title { font-weight: 600; font-size: 16px; }
        .body { flex: 1; overflow-y: auto; overflow-x: hidden; }
        /* Avatar section */
        .profile-top { display: flex; flex-direction: column; align-items: center; padding: 24px 16px 16px; background: #fff; border-bottom: 8px solid #f0f2f5; }
        .avatar-wrap { position: relative; width: 80px; height: 80px; margin-bottom: 12px; }
        .avatar { width: 80px; height: 80px; border-radius: 50%; object-fit: cover; }
        .avatar.placeholder { width: 80px; height: 80px; border-radius: 50%; background: linear-gradient(135deg, #6e8efb, #a777e3); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 36px; font-weight: 500; }
        .avatar-overlay { position: absolute; inset: 0; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.3); color: #fff; font-size: 13px; opacity: 0; transition: opacity .15s; }
        .avatar-wrap:hover .avatar-overlay { opacity: 1; }
        .profile-name { font-size: 18px; font-weight: 600; margin-bottom: 4px; }
        .profile-sub { font-size: 13px; color: #707579; }
        /* Cards */
        .card { background: #fff; margin-bottom: 8px; border: 1px solid #e0e0e0; border-radius: 0; box-sizing: border-box; }
        .card-hdr { padding: 12px 16px; font-size: 13px; font-weight: 600; color: #707579; text-transform: uppercase; letter-spacing: .5px; }
        .card-row { display: flex; align-items: center; gap: 12px; padding: 12px 16px; cursor: pointer; border-top: 1px solid #e0e0e0; }
        .card-row:hover { background: #f7f7f7; }
        .card-row .icon { width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0; }
        .card-row .icon.gray { background: #f0f0f0; }
        .card-row .text { flex: 1; min-width: 0; }
        .card-row .text .main { font-size: 14px; }
        .card-row .text .sub { font-size: 12px; color: #888; margin-top: 2px; }
        .card-row .action { color: #2481cc; font-size: 13px; flex-shrink: 0; }
        .card-row .action.danger { color: #e23b3b; }
        /* Toggle switch */
        .toggle { width: 44px; height: 26px; border-radius: 13px; background: #ccc; position: relative; cursor: pointer; transition: background .2s; flex-shrink: 0; }
        .toggle.on { background: #4ecf5e; }
        .toggle::after { content: ''; position: absolute; top: 2px; left: 2px; width: 22px; height: 22px; border-radius: 50%; background: #fff; transition: left .2s; box-shadow: 0 1px 2px rgba(0,0,0,.15); }
        .toggle.on::after { left: 20px; }
        /* Members */
        .member-row { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-top: 1px solid #e0e0e0; }
        .member-avatar { width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg, #6e8efb, #a777e3); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 500; flex-shrink: 0; }
        .member-avatar.bot { background: #e8e8e8; font-size: 18px; }
        .member-name { flex: 1; min-width: 0; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .role { font-size: 11px; padding: 1px 6px; border-radius: 4px; margin-left: 4px; }
        .role.owner { background: #ffe4c4; color: #b8700a; }
        .role.admin { background: #dceeff; color: #2b86d9; }
        .member-actions { display: flex; gap: 4px; flex-shrink: 0; }
        .member-actions button { width: 28px; height: 28px; border: none; background: none; cursor: pointer; border-radius: 6px; font-size: 14px; color: #888; display: flex; align-items: center; justify-content: center; }
        .member-actions button:hover { background: #f0f0f0; }
        .member-actions button.rm:hover { background: #ffe0e0; color: #e23b3b; }
        /* Picker */
        .picker { background: #fff; border-top: 1px solid #e0e0e0; }
        .pick { display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; border: none; background: none; cursor: pointer; width: 100%; font: inherit; font-size: 14px; }
        .pick:hover { background: #f7f7f7; }
        .pick .sub { color: #4a9eff; font-size: 13px; }
        .err { color: #e23b3b; padding: 12px 16px; font-size: 13px; }
      </style>
      <div class="hdr">
        <button class="back" data-act="close">✕</button>
        <span class="title">Информация</span>
      </div>
      <div class="body">
        <div class="profile-top">
          ${avatarHtml}
          <div class="profile-name">${this._esc(this._roomName || '—')}</div>
          <div class="profile-sub">${memberCount} участник${memberCount % 10 === 1 && memberCount % 100 !== 11 ? '' : 'а'}${botCount ? ', ' + botCount + ' бот' + (botCount > 1 ? 'ов' : '') : ''}</div>
        </div>

        <!-- Notifications -->
        <div class="card">
          <div class="card-row" data-act="mute-toggle">
            <div class="icon gray">🔔</div>
            <div class="text"><div class="main">Уведомления</div></div>
            <div class="toggle ${this._muted ? '' : 'on'}" data-act="mute-toggle"></div>
          </div>
        </div>

        <!-- Members -->
        <div class="card">
          <div class="card-hdr">${memberCount} участник${memberCount % 10 === 1 && memberCount % 100 !== 11 ? '' : 'а'}</div>
          ${this.members.map(m => this._memberHtml(m)).join('')}
          ${canManage ? `<div class="picker">
            ${this._memberPicker ? `
              ${this._availableUsers.map(u => `<button class="pick" data-act="add-member" data-id="${u.id}"><span>${this._esc(u.display_name || u.username)}</span><span class="sub">Добавить</span></button>`).join('')}
              <button class="pick" data-act="member-cancel" style="color:#888">Отмена</button>
            ` : `<div class="card-row" data-act="member-open">
              <div class="icon gray">＋</div>
              <div class="text"><div class="main" style="color:#2481cc">${this._availableUsers.length ? 'Добавить участника' : 'Все в комнате'}</div></div>
            </div>`}
          </div>` : ''}
        </div>

        <!-- Bots -->
        ${botCount > 0 || (canManage && this.myBots.length > 0) ? `<div class="card">
          <div class="card-hdr">Боты</div>
          ${this.bots.map(b => this._botHtml(b)).join('')}
          ${canManage && this.myBots.length > 0 ? `<div class="picker">
            ${this._botPicker ? `
              ${this._availableBots.map(b => `<button class="pick" data-act="add-bot" data-id="${b.id}"><span>🤖 ${this._esc(b.username)}</span><span class="sub">Добавить</span></button>`).join('')}
              <button class="pick" data-act="bot-cancel" style="color:#888">Отмена</button>
            ` : `<div class="card-row" data-act="bot-open">
              <div class="icon gray">🤖</div>
              <div class="text"><div class="main" style="color:#2481cc">Добавить бота</div></div>
            </div>`}
          </div>` : ''}
        </div>` : ''}

        <!-- Delete -->
        ${isOwner ? `<div class="card" style="margin-top:16px">
          <div class="card-row" data-act="delete-room">
            <div class="icon" style="background:#ffe0e0">🗑</div>
            <div class="text"><div class="main" style="color:#e23b3b">${this._confirmDelete ? 'Точно удалить?' : 'Удалить комнату'}</div></div>
          </div>
        </div>` : ''}

        ${this._err ? `<div class="err">${this._esc(this._err)}</div>` : ''}
      </div>`;

    // Header back button
    this._root.querySelector('.hdr').onclick = (e) => { if (e.target.closest('[data-act="close"]')) this._close(); };

    // Delegate all clicks
    this._root.querySelector('.body').onclick = (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
      ({
        'member-open': () => { this._memberPicker = true; this._render(); },
        'member-cancel': () => { this._memberPicker = false; this._render(); },
        'add-member': () => this._addMember(id),
        'rm-member': () => this._removeMember(id),
        'toggle-admin': () => this._toggleAdmin(id),
        'bot-open': () => { this._botPicker = true; this._render(); },
        'bot-cancel': () => { this._botPicker = false; this._render(); },
        'add-bot': () => this._addBot(id),
        'rm-bot': () => this._removeBot(id),
        'delete-room': () => this._deleteRoom(),
        'mute-toggle': () => this._toggleMute(),
      }[act] || (() => {}))();
    };

    // Avatar upload
    const fileInput = this._root.querySelector('[data-act="avatar-upload"]');
    if (fileInput) {
      fileInput.onchange = async () => {
        const file = fileInput.files[0]; if (!file) return;
        try {
          const resized = await resizeImage(file, 512, 512);
          await this._api(`/rooms/${this._roomId}/avatar`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: resized });
          window.dispatchEvent(new CustomEvent('room-info:avatar-changed', { detail: { roomId: this._roomId }, bubbles: true, composed: true }));
          this._avatarUrl = URL.createObjectURL(new Blob([resized], { type: 'image/jpeg' }));
          this._render();
          this._load();
        } catch (e) { this._err = 'Ошибка: ' + e.message; this._render(); }
      };
    }
  }
}

customElements.define('room-info', RoomInfo);
