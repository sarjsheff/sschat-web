// chat-view.js — Web Component: чат с E2E, viewport (40), scroll-back, отправкой.
// Самодостаточный. Импортируется как <chat-view>.
// Отладка: node test/viewport-node.mjs (терминал), потом браузер.

import { decryptBody, encryptBody, decryptBlob, encryptBlob } from './crypto.js';
import { getBase } from './config.js';
import { CHAT_VIEW_CSS } from './chat-view.css.js';
import { escapeHtml, renderMarkdown } from './lib/html.js';
import { albumLayout, fitDimensions } from './lib/album-layout.js';
import { formatSize, dayKey, dayLabel, attKind, mimeFor } from './lib/format.js';

const SLICE = 40;   // шаг сдвига окна (MESSAGE_LIST_SLICE)
const LIMIT = 80;   // максимум сообщений в DOM (MESSAGE_LIST_VIEWPORT_LIMIT)
const TYPING_TTL = 6000;       // мс без обновления → «перестал печатать» (как typing.svelte.js)
const TYPING_THROTTLE = 3000;  // не чаще раза в N мс шлём свой POST /typing

class ChatView extends HTMLElement {
  // ── observed attrs ───────────────────────────────────────
  static get observedAttributes() { return ['token','room','user','roomname','avatarurl']; }

  // Корень рендера: shadowRoot (прод) или сам элемент (тесты-стабы без shadow)
  get _root() { return this.shadowRoot || this; }

  constructor() {
    super();
    // Shadow DOM — полная изоляция стилей (app.css/Tailwind не каскадят внутрь).
    // В тестах-стабах attachShadow нет → _root === this (Light DOM).
    if (this.attachShadow) { try { this.attachShadow({ mode: 'open' }); } catch {} }
    this._token = ''; this._roomId = ''; this._userId = ''; this._roomName = ''; this._avatarUrl = ''; this._initDone = false;
    this.messages = []; this.viewIds = [];
    this.hasMoreOlder = true; this.loadingOlder = false;
    this.names = {}; this.reads = {};
    this._roomKeyRaw = null; // raw AES-256 ключ комнаты (Uint8Array 32B) для E2E
    // bound-обработчики SSE (подписка в connectedCallback, отписка в disconnected)
    this._onIncoming = (e) => this._handleIncoming(e.detail);
    this._onEdited = (e) => this._handleEdited(e.detail);
    this._onDeleted = (e) => this._handleDeleted(e.detail);
    this._onReadState = (e) => this._handleReadState(e.detail);
    this._onTyping = (e) => this._handleTyping(e.detail);
    // Возврат из фона (iOS: разблокировка/foreground) и reconnect SSE → дофетч пропущенного
    this._onVisible = () => { if (typeof document !== 'undefined' && document.visibilityState === 'visible') this._catchUp(); };
    this._onReconnect = () => this._catchUp();
    this._onKeydown = (e) => {
      if (!this._lightboxOpen) return;
      if (e.key === 'Escape') this._closeLightbox();
      else if (e.key === 'ArrowLeft') this._lbGo(-1);
      else if (e.key === 'ArrowRight') this._lbGo(1);
    };
    this._lbScale = 1; this._lbX = 0; this._lbY = 0;
    this._onPaste = (e) => this._handlePaste(e);
    this._lightboxOpen = false;
    this._pendingSeq = 0; // счётчик оптимистичных превью-сообщений
    this._pinBottom = false; // жёстко держать низ (при открытии/догрузке), снимается при скролле вверх
    this._newCount = 0;      // счётчик новых сообщений на FAB (пока юзер в истории)
    this._typers = {};          // uid → lastSeenMs (чужие, кто печатает)
    this._lastTypingSent = 0;   // throttle своих POST /typing
    this._menuFor = null;       // msgId с открытым контекстным меню
    this._delConfirm = null;    // msgId в режиме подтверждения удаления
    this._editingId = null;     // msgId, который сейчас редактируем
    this._renderedIds = new Set(); // ID сообщений отрендеренных в прошлый раз (для анимации new-msg)
    this._loadGen = 0;         // поколение загрузки — защита от stale async при переключении комнат
  }

  // ── Контекстное меню (правка/удаление своих) ─────────────
  _startEdit(id) {
    const m = this.messages.find(x => x.id === id);
    if (!m) return;
    this._menuFor = null; this._delConfirm = null;
    // Сообщение с картинками → диалог (правка подписи, как telegram web)
    if (this._openEditDialog(id)) { this._render(); return; }
    // Текстовое — правка инлайн в инпуте
    this._editingId = id;
    const input = this._root.querySelector('#input');
    const send = this._root.querySelector('#send');
    if (input) { input.value = this._parseBody(this._decrypt(m.body, m._plaintext)); input.focus(); }
    if (send) send.textContent = 'Сохранить';
    this._render();
  }

  _cancelEdit() {
    this._editingId = null;
    const input = this._root.querySelector('#input');
    const send = this._root.querySelector('#send');
    if (input) input.value = '';
    if (send) send.textContent = 'Отправить';
  }
  async _doDelete(id) {
    this._menuFor = null; this._delConfirm = null;
    try {
      const r = await fetch(getBase() + `/rooms/${this._roomId}/messages/${id}`, {
        method: 'DELETE', headers: { Authorization: 'Bearer ' + this._token }
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      // SSE message_deleted прилетит и уберёт из ленты; оптимистично тоже убираем
      this._handleDeleted({ id, room_id: this._roomId, deleted_at: 'now' });
    } catch (e) { console.error('delete:', e); this._render(); }
  }

  // ── Typing «печатает…» ───────────────────────────────────
  _handleTyping(d) {
    if (!d || d.room_id !== this._roomId || d.user_id === this._userId) return;
    this._typers[d.user_id] = Date.now();
    if (!(d.user_id in this.names)) this._resolveNames();
    this._renderTyping();
  }
  _liveTypers() {
    const now = Date.now();
    return Object.entries(this._typers)
      .filter(([uid, t]) => uid !== this._userId && now - t < TYPING_TTL)
      .map(([uid]) => this.names[uid] ?? uid.slice(0, 8));
  }
  _renderTyping() {
    const el = this._root.querySelector('#typing');
    if (!el) return;
    const live = this._liveTypers();
    el.textContent = live.length
      ? (live.length === 1 ? `${live[0]} печатает…` : `${live.join(', ')} печатают…`)
      : '';
  }
  // GC раз в секунду гасит протухших (реактивно убирает «печатает»)
  _startTypingGC() {
    if (this._typingTimer) return;
    this._typingTimer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [uid, t] of Object.entries(this._typers)) {
        if (now - t >= TYPING_TTL) { delete this._typers[uid]; changed = true; }
      }
      if (changed) this._renderTyping();
    }, 1000);
  }
  // Свой POST /typing с throttle (дёргается на input)
  _sendTyping() {
    const now = Date.now();
    if (now - this._lastTypingSent < TYPING_THROTTLE) return;
    this._lastTypingSent = now;
    fetch(getBase() + `/rooms/${this._roomId}/typing`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + this._token, 'Content-Type': 'application/json' },
      body: '{}'
    }).catch(() => {});
  }

  // Цвет имени из user_id (telegram-style legacy: хэш id → индекс палитры).
  // Детерминированно — один юзер всегда один цвет, без согласования клиентов.
  _nameColor(uid) {
    const COLORS = ['#e17076', '#eda86c', '#a695e7', '#7bc862', '#6ec9cb', '#65aadd', '#ee7aae'];
    let h = 0;
    for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
    return COLORS[h % COLORS.length];
  }

  // ── Имена авторов + read-receipts ────────────────────────
  async _fetchUser(id) {
    // cache-first: мгновенно из IndexedDB (имена участников переживают перезаход),
    // сеть обновляет в фоне. Тест-стабы без cache.js → сразу сеть.
    try {
      const { getCachedUser, putCachedUser } = await import('./cache.js');
      const cached = await getCachedUser(id);
      if (cached) {
        fetch(getBase() + `/users/${id}`, { headers: { Authorization: 'Bearer ' + this._token } })
          .then(r => r.ok ? r.json() : null).then(u => { if (u) putCachedUser(u); }).catch(() => {});
        return cached;
      }
      const r = await fetch(getBase() + `/users/${id}`, { headers: { Authorization: 'Bearer ' + this._token } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const u = await r.json();
      putCachedUser(u);
      return u;
    } catch (e) {
      const r = await fetch(getBase() + `/users/${id}`, { headers: { Authorization: 'Bearer ' + this._token } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }
  }
  // Резолв имён всех упомянутых user_id (авторы + читатели). Кэш в this.names.
  async _resolveNames() {
    const ids = new Set();
    for (const m of this.messages) if (m.user_id) ids.add(m.user_id); // включая себя (показываем своё имя)
    for (const uid of Object.keys(this.reads)) if (uid !== this._userId) ids.add(uid);
    const missing = [...ids].filter(uid => !(uid in this.names));
    if (missing.length === 0) return;
    await Promise.all(missing.map(async uid => {
      try { const u = await this._fetchUser(uid); this.names[uid] = u.display_name || u.username || uid.slice(0,8); }
      catch { this.names[uid] = uid.slice(0,8); }
    }));
    // Точечно обновляем имена в DOM — БЕЗ полного _render (иначе #list переписывается
    // и <img> пересоздаются/мигают, пока картинки грузятся).
    const list = this._root.querySelector('#list');
    if (list) for (const el of list.querySelectorAll('.name[data-uid]')) {
      const nm = this.names[el.dataset.uid]; if (nm) el.textContent = nm;
    }
  }
  // SSE read_state: кто-то прочитал → обновить reads → перерисовать ✓✓
  _handleReadState(d) {
    if (!d || d.room_id !== this._roomId || !d.user_id) return;
    const prev = this.reads[d.user_id];
    if (prev && prev >= d.last_read) return; // не откатываем назад
    this.reads[d.user_id] = d.last_read;
    if (d.user_id !== this._userId) this._render(); // чужой прогресс чтения → ✓✓
  }

  // ── SSE live (как telegram-tt: новое → вниз если у края, иначе FAB) ──
  _handleIncoming(m) {
    if (!m || m.room_id !== this._roomId) return;
    if (this.messages.some(x => x.id === m.id)) return; // дубль (свой POST вернётся через SSE)
    // Своё эхо → снять оптимистичный pending (если SSE опередил ответ POST)
    if (m.user_id === this._userId) {
      const a = this._attachmentsOf(this._decrypt(m.body, m._plaintext));
      if (a) {
        const ids = new Set(a.atts.map(x => x.id));
        const p = this.messages.find(x => x._pending && x._attIds && [...x._attIds].some(id => ids.has(id)));
        if (p) this._removePending(p);
      } else {
        // текстовый pending (часики) — заменяем самый старый на реальное, FIFO
        const i = this.messages.findIndex(x => x._sending && !x._attIds);
        if (i >= 0) {
          this.messages.splice(i, 1);
          if (this.viewIds) this.viewIds = this.viewIds.filter(id => this.messages.some(x => x.id === id));
        }
      }
    }
    const wasAtEdge = this._atNewestEdge(); // ДО вставки — иначе новое само станет новейшим
    this._insertMsg(m); // вставка в позицию вместо push+полный sort
    if (wasAtEdge) {
      this._updateViewport('bottom');
      this._render();
      this._scrollBottom();
      this._markRead(m.id);
    } else {
      // не у края — окно не двигаем; чужое сообщение увеличивает счётчик на FAB
      if (m.user_id !== this._userId) this._newCount = (this._newCount || 0) + 1;
      this._updateFab();
    }
    if (m.user_id && m.user_id !== this._userId && !(m.user_id in this.names)) this._resolveNames();
    this._cacheMsg(m);
  }
  // Догнать сообщения, пришедшие пока SSE был мёртв (фон/блокировка телефона).
  // Вызывается на visibilitychange→visible и sse:hello (reconnect).
  async _catchUp() {
    if (!this._token || !this._roomId || this._catchingUp || !this.messages) return;
    this._catchingUp = true;
    const gen = this._loadGen;
    try {
      const fresh = await this._api(`/rooms/${this._roomId}/messages?limit=100`);
      if (gen !== this._loadGen) return;
      if (Array.isArray(fresh)) {
        fresh.reverse();
        const known = new Set(this.messages.map(m => m.id));
        const neu = fresh.filter(m => m && !known.has(m.id));
        if (neu.length) {
          for (const m of neu) m._plaintext = this._decrypt(m.body, m._plaintext);
          const wasAtEdge = this._atNewestEdge();
          this.messages.push(...neu);
          this.messages.sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
          if (wasAtEdge) {
            this._updateViewport('bottom'); this._render(); this._scrollBottom();
            this._markRead(this.messages[this.messages.length-1].id);
          } else {
            const others = neu.filter(m => m.user_id !== this._userId).length;
            if (others) this._newCount = (this._newCount || 0) + others;
            this._render(); this._updateFab();
          }
          this._resolveNames();
          this._cacheCurrent();
        }
      }
    } catch (e) { console.error('catchUp:', e); }
    this._catchingUp = false;
  }
  _handleEdited(m) {
    if (!m || m.room_id !== this._roomId) return;
    const cur = this.messages.find(x => x.id === m.id);
    if (!cur) return;
    cur.body = m.body; cur.edited_at = m.edited_at;
    delete cur._plaintext; // сбросить кеш — body изменился
    if (this.viewIds.includes(m.id)) this._render();
    this._cacheMsg(cur);
  }
  _handleDeleted(m) {
    if (!m || m.room_id !== this._roomId) return;
    const i = this.messages.findIndex(x => x.id === m.id);
    if (i < 0) return;
    const inView = this.viewIds.includes(m.id);
    this.messages.splice(i, 1);
    if (inView) { this._updateViewport(this._atNewestEdge() ? 'bottom' : 'older'); this._render(); }
    this._cacheRemove(m.id);
  }

  _markRead(msgId) {
    fetch(getBase() + `/rooms/${this._roomId}/read`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + this._token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_id: msgId })
    }).catch(() => {});
  }

  // ── E2E ──────────────────────────────────────────────────
  // Загрузка identity + roomKey. Динамический import — статический потянул бы
  // api.js/idb в терминальный тест. Тест ставит _roomKeyRaw напрямую.
  async _loadKey() {
    try {
      const { loadOrCreateIdentity } = await import('./identity.js');
      const { ensureRoomKey } = await import('./room-key.js');
      const id = await loadOrCreateIdentity();
      const entry = await ensureRoomKey(this._roomId, id.priv);
      this._roomKeyRaw = entry ? entry.raw : null;
      if (!this._roomKeyRaw) console.warn('chat-view: roomKey недоступен для', this._roomId.slice(0,8));
    } catch (e) { console.error('chat-view _loadKey:', e); this._roomKeyRaw = null; }
  }

  // Расшифровать тело. Без ключа: ciphertext (v:1) → •••, иначе как есть.
  _isEncrypted(body) {
    if (!body || !body.startsWith('{')) return false;
    try { return JSON.parse(body).v === 1; } catch { return false; }
  }
  _decrypt(body, plaintext) {
    if (plaintext !== undefined) return plaintext;
    if (!body || !body.startsWith('{')) return body;
    if (!this._roomKeyRaw) {
      try { if (JSON.parse(body).v === 1) return '•••'; } catch {}
      return body;
    }
    return decryptBody(body, this._roomKeyRaw);
  }
  // Svelte ставит свойства напрямую (не атрибуты) и пере-сетит их на каждом
  // ре-рендере родителя (refreshRooms на любом SSE). Guard на равенство —
  // иначе _init() пересоздаёт каркас/input на каждое событие → потеря фокуса.
  set token(v) { if (v === this._token) return; this._token = v; this.setAttribute('token',v); if (this._roomId && this.isConnected && !this._initDone) this._init(); }
  get token() { return this._token; }
  set room(v) { if (v === this._roomId) return; this._roomId = v; this.setAttribute('room',v); this.messages=[]; this.viewIds=[]; this._typers={}; this._built=false; this._initDone=false; this._renderedIds.clear(); this._clearIdleTimers(); this._loadGen++; if (this._token && this.isConnected) this._init(); }
  get room() { return this._roomId; }
  set user(v) { if (v === this._userId) return; this._userId = v; this.setAttribute('user',v); }
  get user() { return this._userId; }
  set roomname(v) { if (v === this._roomName) return; if (!v && this._roomName) return; this._roomName = v || ''; this._updateRoomName(); }
  get roomname() { return this._roomName; }
  _updateRoomName() {
    const el = this._root.querySelector && this._root.querySelector('.room-name');
    if (el) el.textContent = this._roomName || this.getAttribute('roomname') || this._roomId.slice(0, 12);
  }
  _updateAvatar() {
    const el = this._root.querySelector && this._root.querySelector('#head-avatar');
    if (!el) return;
    if (this._avatarUrl) {
      el.src = this._avatarUrl;
      el.style.display = '';
    } else {
      el.src = '';
      el.style.display = 'none';
    }
  }

  connectedCallback() {
    this._token = this.getAttribute('token') || '';
    this._roomId = this.getAttribute('room') || '';
    this._userId = this.getAttribute('user') || '';
    this._roomName = this.getAttribute('roomname') || '';
    this._avatarUrl = this.getAttribute('avatarurl') || '';
    window.addEventListener('sse:message', this._onIncoming);
    window.addEventListener('sse:message_edited', this._onEdited);
    window.addEventListener('sse:message_deleted', this._onDeleted);
    window.addEventListener('sse:read_state', this._onReadState);
    window.addEventListener('sse:typing', this._onTyping);
    window.addEventListener('keydown', this._onKeydown);
    window.addEventListener('paste', this._onPaste);
    window.addEventListener('sse:hello', this._onReconnect); // SSE переподключился — догнать пропущенное
    if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('visibilitychange', this._onVisible);
    // Svelte может устанавливать атрибуты после connectedCallback — даём microtask
    queueMicrotask(() => {
      this._token = this.getAttribute('token') || this._token;
      this._roomId = this.getAttribute('room') || this._roomId;
      this._userId = this.getAttribute('user') || this._userId;
      this._roomName = this.getAttribute('roomname') || this._roomName;
      this._avatarUrl = this.getAttribute('avatarurl') || this._avatarUrl;
      // _init вызывается из set room / attributeChangedCallback при реальной смене комнаты
      if (this._token && this._roomId && !this._initDone) this._init();
    });
  }

  disconnectedCallback() {
    window.removeEventListener('sse:message', this._onIncoming);
    window.removeEventListener('sse:message_edited', this._onEdited);
    window.removeEventListener('sse:message_deleted', this._onDeleted);
    window.removeEventListener('sse:read_state', this._onReadState);
    window.removeEventListener('sse:typing', this._onTyping);
    window.removeEventListener('keydown', this._onKeydown);
    window.removeEventListener('paste', this._onPaste);
    window.removeEventListener('sse:hello', this._onReconnect);
    if (typeof document !== 'undefined' && document.removeEventListener) document.removeEventListener('visibilitychange', this._onVisible);
    if (this._obsTop) this._obsTop.disconnect();
    if (this._obsBottom) this._obsBottom.disconnect();
    if (this._attObs) this._attObs.disconnect();
    if (this._typingTimer) { clearInterval(this._typingTimer); this._typingTimer = null; }
    this._clearIdleTimers();
    if (this._attUrls) { for (const u of this._attUrls.values()) URL.revokeObjectURL(u); this._attUrls.clear(); }
  }

  attributeChangedCallback(name, old, val) {
    if (old === val || val === null) return;
    if (name === 'token') this._token = val;
    if (name === 'room' && val !== this._roomId) { this._roomId = val; this.messages=[]; this.viewIds=[]; this._typers={}; this._built=false; this._initDone=false; this._renderedIds.clear(); this._clearIdleTimers(); this._loadGen++; this._init(); return; }
    if (name === 'user') this._userId = val;
    if (name === 'roomname') { this._roomName = val; this._updateRoomName(); }
    if (name === 'avatarurl') { this._avatarUrl = val; this._updateAvatar(); }
  }

  // ── API ──────────────────────────────────────────────────
  async _api(path) {
    const r = await fetch(getBase() + path, {
      headers: { Authorization: 'Bearer ' + this._token }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  // ── Viewport (скользящее окно по allIds, как в telegram-tt) ──
  // Мемоизация: onscroll дёргает _atNewestEdge/_updateFab (по 2 sort на событие),
  // а массив во время жеста скролла не меняется. Ключ - длина+границы: при любой
  // добавке/удалении длина или крайний id меняются → пересчёт. Правки (edit тела)
  // порядок не меняют → кеш валиден. Сообщения держатся отсортированными; sort
  // оставлен страховкой от редкой неупорядоченной вставки (self-heal на след. мутации).
  _allIdsSorted() {
    const n = this.messages.length;
    if (n === 0) return [];
    const key = n + ':' + this.messages[0].id + ':' + this.messages[n - 1].id;
    if (this._idsCacheKey === key) return this._idsCache;
    const ids = this.messages.map(m => m.id);
    ids.sort(); // ULID 26 chars → alpha = chrono
    this._idsCacheKey = key;
    this._idsCache = ids;
    return ids;
  }

  // Вставка одного сообщения с сохранением сортировки по id (без полного re-sort).
  // Бинарный поиск позиции. Для одиночных входящих дешевле O(n log n) сортировки.
  _insertMsg(m) {
    const a = this.messages;
    let lo = 0, hi = a.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid].id < m.id) lo = mid + 1; else hi = mid; }
    a.splice(lo, 0, m);
  }

  _updateViewport(mode = 'bottom') {
    const ids = this._allIdsSorted();
    if (ids.length === 0) return;
    if (mode === 'older' && this.viewIds.length > 0) {
      const firstIdx = ids.indexOf(this.viewIds[0]);
      const start = Math.max(0, firstIdx - SLICE);
      const next = ids.slice(start, Math.min(ids.length, start + LIMIT));
      if (next.length === 0) return;
      this.viewIds = next;
    } else if (mode === 'newer' && this.viewIds.length > 0) {
      const lastIdx = ids.indexOf(this.viewIds[this.viewIds.length - 1]);
      const end = Math.min(ids.length, lastIdx + 1 + SLICE);
      const next = ids.slice(Math.max(0, end - LIMIT), end);
      if (next.length > 0) this.viewIds = next;
    } else {
      this.viewIds = ids.slice(-SLICE);
    }
  }

  _atNewestEdge() {
    const ids = this._allIdsSorted();
    return this.viewIds.length === 0 || this.viewIds[this.viewIds.length - 1] === ids[ids.length - 1];
  }


  // HTML выпадающего меню (если открыто). mine → правка/удаление, чужое → копировать.
  _menuHtml(id, mine) {
    if (this._menuFor !== id) return '';
    if (this._delConfirm === id) {
      return `<div class="msg-menu">
        <button data-act="delyes" data-id="${id}" class="danger">⚠ Точно удалить?</button>
        <button data-act="delno" data-id="${id}">Отмена</button>
      </div>`;
    }
    if (!mine) {
      return `<div class="msg-menu">
        <button data-act="copy" data-id="${id}">Копировать</button>
      </div>`;
    }
    return `<div class="msg-menu">
      <button data-act="edit" data-id="${id}">Редактировать</button>
      <button data-act="copy" data-id="${id}">Копировать</button>
      <button data-act="del" data-id="${id}" class="danger">Удалить</button>
    </div>`;
  }
  _doCopy(id) {
    const m = this.messages.find(x => x.id === id);
    this._menuFor = null;
    if (m) { try { navigator.clipboard?.writeText(this._parseBody(this._decrypt(m.body, m._plaintext))); } catch {} }
    this._render();
  }

  // Чистый расчёт позиции fixed-меню: под кнопкой, но в пределах окна.
  // mine → выравниваем по правому краю кнопки, their → по левому. PAD=8 от краёв.
  _clampMenuPos(btn, menuW, menuH, vw, vh, mine) {
    const PAD = 8, GAP = 4;
    let top = btn.bottom + GAP;
    if (top + menuH > vh - PAD) top = btn.top - menuH - GAP; // не влезает вниз → вверх
    if (top < PAD) top = PAD;
    let left = mine ? btn.right - menuW : btn.left;
    if (left + menuW > vw - PAD) left = vw - PAD - menuW;     // не влезает вправо
    if (left < PAD) left = PAD;                                // не влезает влево
    return { top, left };
  }

  // Спозиционировать открытое меню (fixed, не обрезается overflow #scroll)
  _positionMenu() {
    if (!this._menuFor) return;
    const menu = this._root.querySelector('.msg-menu');
    const btn = this._root.querySelector(`.msg-menu-btn[data-id="${this._menuFor}"]`);
    if (!menu || !btn || typeof window === 'undefined') return;
    const mine = !!btn.closest('.msg-row.mine');
    const mr = menu.getBoundingClientRect(), br = btn.getBoundingClientRect();
    const { top, left } = this._clampMenuPos(br, mr.width, mr.height, window.innerWidth, window.innerHeight, mine);
    menu.style.top = top + 'px';
    menu.style.left = left + 'px';
  }

  // ── Render ───────────────────────────────────────────────
  _render() {
    const msgs = this.viewIds.map(id => this.messages.find(m => m.id === id)).filter(Boolean);
    const msgById = new Map(this.messages.map((m,i) => [m.id, m]));

    const html = msgs.map((m, i) => {
      const mine = m.user_id === this._userId;
      if (m._pending) return this._pendingHtml(m); // оптимистичное превью отправки

      const prev = i > 0 ? msgs[i-1] : null;
      const daySep = !prev || dayKey(m.created_at) !== dayKey(prev.created_at)
        ? `<div class="day-sep">${dayLabel(m.created_at)}</div>` : '';

      const nameStr = mine ? (this.names[m.user_id] ?? 'Вы') : (this.names[m.user_id] ?? m.user_id.slice(0,8));
      const dec = this._decrypt(m.body, m._plaintext);
      const att = this._attachmentsOf(dec);
      const text = att ? att.caption : this._parseBody(dec);
      let attHtml = '';
      if (att) {
        // Картинки → мозаика-галерея; видео/аудио/файлы → карточки/плееры списком
        const visual = att.atts.filter(a => attKind(a) === 'image');
        const other = att.atts.filter(a => attKind(a) !== 'image');
        if (visual.length === 1) {
          const a0 = visual[0], d = fitDimensions(a0.w, a0.h);
          const st = d ? `width:${d.w}px;height:${d.h}px` : 'width:200px;height:160px';
          attHtml += this._attBoxHtml(a0, st);
        } else if (visual.length > 1) {
          const ratios = visual.map(a => (a.w && a.h) ? a.w / a.h : 1);
          const lay = albumLayout(ratios);
          attHtml += `<div class="att-gallery" style="position:relative;width:${lay.width}px;height:${lay.height}px">${
            visual.map((a, i) => {
              const r = lay.items[i];
              return this._attBoxHtml(a, `position:absolute;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`);
            }).join('')}</div>`;
        }
        attHtml += other.map(a => this._attFileHtml(a)).join('');
      }
      const time = new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
      const edited = m.edited_at ? '<span class="edited">(ред.)</span> ' : '';
      const readers = this._readersOf(m.id);
      const readByOther = mine && readers.length > 0;
      const menu = this._menuHtml(m.id, mine);

      const encrypted = this._isEncrypted(m.body);
      const isNew = this._renderedIds && !this._renderedIds.has(m.id);
      return `${daySep}
        <div class="msg-row ${mine?'mine':'their'}${isNew?' new-msg':''}">
          <div class="chat-bubble ${mine?'mine':''}${encrypted?'':' plaintext'}" data-msgid="${m.id}"${encrypted?'':` title="Незашифрованное сообщение"`}>
            <div class="bubble-head">
              <div class="name" data-uid="${m.user_id}" style="color:${mine ? '#888' : this._nameColor(m.user_id)}">${nameStr}</div>
              <button class="msg-menu-btn" data-act="menu" data-id="${m.id}" title="Меню">⋮</button>
            </div>
            ${attHtml ? `<div class="att-wrap">${attHtml}</div>` : ''}
            ${text ? `<div class="msg-text">${renderMarkdown(text)}</div>` : ''}
            <span class="time">${encrypted ? '' : '<span class="plaintext-badge" title="Незашифрованно">🔓</span>'}${edited}${time}${mine ? (m._sending
              ? '<span class="status sending" title="Отправляется">🕐</span>'
              : m._failed
                ? '<span class="status failed" title="Не отправлено">⚠</span>'
                : `<span class="status ${readByOther?'read':''}" title="${readByOther?'Прочитано: '+readers.join(', '):'Отправлено'}">${readByOther?'✓✓':'✓'}</span>`) : ''}</span>
            ${menu}
          </div>
        </div>`;
    }).join('');

    const loadState = this.messages.length === 0
      ? (this._initDone ? '' : `<div class="skeleton-list">
${Array.from({length:6}, (_,i) => {
  const w = [60,80,45,70,55,90][i];
  const ml = i%2===0 ? '' : 'margin-left:auto;';
  return `<div class="skel-msg" style="width:${w}%;${ml}"><div class="skel-bar" style="width:${[30,60,40,50,35,65][i]}%"></div></div>`;
}).join('\n')}
</div>`)
      : !this.hasMoreOlder
        ? '<div class="day-sep">Начало истории</div>'
        : '<div class="day-sep">Листайте вверх...</div>';

    // Каркас строится ОДИН раз. Дальше перерисовывается только #list —
    // #scroll и его scrollTop сохраняются, observers не пере-вешаются.
    if (!this._built) { this._buildShell(); this._render(); }

    // Держим низ: _pinBottom (открытие/догрузка) — жёстко; иначе stick если были у края
    const scrollEl = this._root.querySelector('#scroll');
    const stick = scrollEl && (this._pinBottom || (this._atNewestEdge() &&
      scrollEl.scrollTop + scrollEl.clientHeight + 80 >= scrollEl.scrollHeight));

    // loadState — отдельно от #list, чтобы его смена (deltaFetch: «Листайте»→«Начало»)
    // не переписывала #list и не пересоздавала <img>
    const ls = this._root.querySelector('#loadstate');
    if (ls && ls.__html !== loadState) { ls.innerHTML = loadState; ls.__html = loadState; }

    const list = this._root.querySelector('#list');
    // dedup: переписываем #list только если HTML сообщений изменился (иначе <img> мигают)
    if (list && list.__html !== html) { list.innerHTML = html; list.__html = html; }

    // Сохраняем позицию скролла: запоминаем смещение первого видимого сообщения
    // относительно верха #scroll ДО замены DOM, и восстанавливаем ПОСЛЕ.
    // rAF — чтобы WKWebView не перетёр скролл асинхронным сбросом.
    if (this._anchorData && scrollEl) {
      const a = this._anchorData;
      this._anchorData = null;
      const apply = () => {
        const el = this._findMsgEl(scrollEl, a.id); // WKWebView-safe (не querySelector)
        if (!el) return;
        const newTop = el.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top;
        scrollEl.scrollTo(0, this._anchorTarget(scrollEl.scrollTop, newTop, a.top));
        void scrollEl.offsetHeight; // форс-layout: иначе WKWebView асинхронно сбросит scrollTop
      };
      apply(); // синхронно — обычные браузеры применяют сразу
      // повтор в rAF: WKWebView перетирает scrollTop после innerHTML. Формула
      // _anchorTarget идемпотентна (второй вызов даёт ту же позицию), безопасно.
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
    }

    // Запомнить ID для анимации new-msg в следующий раз
    this._renderedIds = new Set(this.viewIds);

    if (stick && scrollEl) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
      // WKWebView асинхронно сбрасывает scrollTop после innerHTML — дожимаем в rAF,
      // но только если юзер всё ещё у низа (не перебиваем уход в историю).
      if (typeof requestAnimationFrame === 'function')
        requestAnimationFrame(() => { if (this._pinBottom || this._atBottomFlag) scrollEl.scrollTop = scrollEl.scrollHeight; });
    }

    const fab = this._root.querySelector('#fab');
    if (fab) this._updateFab();

    this._positionMenu(); // fixed-меню: позиция у кнопки в пределах окна
    this._loadAllAttachments();
  }

  // ── Загрузка вложений ──────────────────────────────────────
  // WKWebView (Tauri): querySelectorAll/getElementsByClassName/classList.contains
  // внутри Shadow DOM не работают. Обходим children рекурсивно, проверяя className.
  _loadAllAttachments() {
    const list = this._root.querySelector && this._root.querySelector('#list');
    if (!list) return;
    const hasClass = (el, cls) => el.className && (' ' + el.className + ' ').indexOf(' ' + cls + ' ') !== -1;
    const needLoad = [];
    const walk = (el) => {
      if (hasClass(el, 'att-box')) {
        let hasShown = false;
        if (el.children) for (const c of el.children) {
          if (hasClass(c, 'att-img') && hasClass(c, 'shown')) { hasShown = true; break; }
        }
        if (!hasShown && !hasClass(el, 'att-broken') && !el.dataset.loading && el.dataset.full) needLoad.push(el);
      }
      if (hasClass(el, 'att-media')) {
        if (!hasClass(el, 'att-broken') && !el.dataset.loading && el.dataset.full) {
          if (!el.src || el.src.startsWith('about:')) needLoad.push(el);
        }
      }
      if (el.children) for (const c of el.children) walk(c);
    };
    for (const c of list.children) walk(c);
    for (const el of needLoad) {
      el.dataset.observed = '1';
      if (hasClass(el, 'att-media')) this._loadAttachmentMedia(el);
      else this._loadAttachmentBox(el);
    }
  }

  // Статический каркас: style/header/#scroll(#sent-top/#list/#sent-bottom)/fab/input.
  _buildShell() {
    this._root.innerHTML = `
      <style>${CHAT_VIEW_CSS}</style>
      <div class="header" id="header">
        <button class="back-btn" id="back" title="К списку комнат"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>
        <img class="head-avatar" id="head-avatar" src="" alt="" style="display:none" />
        <div class="head-text"><div class="room-name">${escapeHtml(this._roomName || this.getAttribute('roomname') || this._roomId.slice(0,12))}</div><div class="typing" id="typing"></div></div>
      </div>
      <div class="scroll" id="scroll"><div id="sent-top" style="height:1px"></div><div id="loadstate"></div><div id="list"></div><div id="sent-bottom" style="height:1px"></div></div>
      <button class="fab" id="fab" title="Вниз">↓</button>
      <div class="input-row">
        <label class="att-btn" id="attbtn" title="Прикрепить картинку">📎<input id="file" type="file" accept="*/*" multiple hidden></label>
        <textarea id="input" placeholder="Сообщение" autocomplete="off" rows="1"></textarea>
        <button id="send">Отправить</button>
      </div>
      <div class="lightbox" id="lightbox"></div>
      <div class="send-dialog" id="send-dialog">
        <div class="sd-box">
          <div class="sd-title" id="sd-title">Отправить картинку</div>
          <div class="sd-previews" id="sd-previews"></div>
          <label class="sd-add" id="sd-add">+ Добавить<input id="sd-file" type="file" accept="*/*" multiple hidden></label>
          <input class="sd-caption" id="sd-caption" placeholder="Подпись (необязательно)" autocomplete="off">
          <div class="sd-actions">
            <button class="sd-cancel" id="sd-cancel">Отмена</button>
            <button class="sd-send" id="sd-send">Отправить</button>
          </div>
        </div>
      </div>`;

    const scrollEl = this._root.querySelector('#scroll');
    const sentTop = this._root.querySelector('#sent-top');
    const sentBottom = this._root.querySelector('#sent-bottom');
    const fab = this._root.querySelector('#fab');
    const input = this._root.querySelector('#input');
    const sendBtn = this._root.querySelector('#send');
    const list = this._root.querySelector('#list');

    // IntersectionObserver вешаются ОДИН раз на стабильные узлы.
    this._obsTop = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) this._loadOlder();
    }, { root: scrollEl, rootMargin: '200px 0px 0px 0px' });
    this._obsTop.observe(sentTop);
    this._obsBottom = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) this._shiftNewer();
    }, { root: scrollEl, rootMargin: '0px 0px 200px 0px' });
    this._obsBottom.observe(sentBottom);

    // Ленивая загрузка вложений: грузим только видимые (+200px preload-зона)
    this._attObs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        this._attObs.unobserve(e.target);
        if (e.target.classList.contains('att-media')) this._loadAttachmentMedia(e.target);
        else this._loadAttachmentBox(e.target);
      }
    }, { root: scrollEl, rootMargin: '200px' });

    // Тач-трекинг для _gestureActive: во время жеста/инерции WKWebView затирает
    // программный scrollTop — DOM-мутации скролла откладываются до тишины.
    scrollEl.addEventListener('touchstart', () => { this._touchDown = true; }, { passive: true });
    const onTouchEnd = () => { this._touchDown = false; this._lastTouchEnd = Date.now(); };
    scrollEl.addEventListener('touchend', onTouchEnd, { passive: true });
    scrollEl.addEventListener('touchcancel', onTouchEnd, { passive: true });

    scrollEl.onscroll = () => {
      this._lastScrollEvt = Date.now();
      // Снять пин и проверить подгрузку — СИНХРОННО (до rAF): _pinBottom влияет
      // на guard в _loadOlder, а откладывание на кадр создаёт гонку с observer'ом.
      const dist0 = scrollEl.scrollHeight - scrollEl.clientHeight - scrollEl.scrollTop;
      if (dist0 > 40) this._pinBottom = false; // юзер ушёл от низа — снять пин
      // WKWebView: IntersectionObserver #sent-top не всегда пере-срабатывает после
      // подгрузки (интерсекция не меняется) → пагинация «висит» пока не скрольнёшь.
      // Дублируем триггер по позиции скролла. throttle(500ms)+loadingOlder-guard
      // внутри _loadOlder защищают от петли.
      if (scrollEl.scrollTop < 400 && this.hasMoreOlder && !this.loadingOlder && !this._pinBottom) this._loadOlder();
      // rAF-throttle: события скролла сыпятся десятками в кадр, а тут _atNewestEdge
      // (мемо-sort) + _updateFab. Коалесцируем в один кадр.
      if (this._scrollRAF) return;
      const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
      this._scrollRAF = raf(() => {
        this._scrollRAF = 0;
        const dist = scrollEl.scrollHeight - scrollEl.clientHeight - scrollEl.scrollTop;
        // трекаем «у нижнего края» для stick-to-bottom при догрузке картинок
        this._atBottomFlag = this._atNewestEdge() && dist <= 80;
        this._updateFab();
        if (this._menuFor) { this._menuFor = null; this._delConfirm = null; this._render(); } // меню fixed — гасим при скролле
      });
    };

    // Drag-n-drop файлов в область сообщений → диалог отправки
    scrollEl.ondragover = (e) => { e.preventDefault(); scrollEl.classList.add('drag-over'); };
    scrollEl.ondragleave = (e) => { if (e.target === scrollEl) scrollEl.classList.remove('drag-over'); };
    scrollEl.ondrop = (e) => {
      e.preventDefault(); scrollEl.classList.remove('drag-over');
      const files = [...((e.dataTransfer && e.dataTransfer.files) || [])];
      if (files.length) this._openSendDialog(files);
    };

    fab.onclick = () => {
      this._updateViewport('bottom');
      this._render();
      this._scrollBottom();
      const s = this._root.querySelector('#scroll');
      // sh может подрасти после декода картинок → дожимаем в rAF и через 100мс
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { if (s) s.scrollTop = s.scrollHeight; });
      setTimeout(() => { if (s) s.scrollTop = s.scrollHeight; }, 100);
    };

    const send = async () => {
      const txt = input.value.trim();
      if (!txt) return;
      const editingId = this._editingId; // если редактируем — PATCH вместо POST
      input.value = ''; input.style.height = 'auto';
      // Шифруем тем же roomKey. Без ключа — отправка plaintext (fallback).
      const body = this._roomKeyRaw ? encryptBody(txt, this._roomKeyRaw) : txt;

      if (editingId) {
        try {
          const resp = await fetch(getBase() + `/rooms/${this._roomId}/messages/${editingId}`, {
            method: 'PATCH',
            headers: { 'Authorization': 'Bearer ' + this._token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ body })
          });
          if (!resp.ok) throw new Error('edit failed');
          this._cancelEdit();
        } catch(e) { console.error(e); }
        return;
      }

      // Оптимистичная отправка (telegram-style): сразу показываем сообщение с «часиками»,
      // по ответу POST заменяем на реальное (с галочкой). SSE-эхо дедупится по id.
      const tempId = 'pending-' + String(++this._pendingSeq || (this._pendingSeq = 1)).padStart(20, '0');
      const pmsg = { id: tempId, user_id: this._userId, body, created_at: new Date().toISOString(), _pending: true, _sending: true };
      this.messages.push(pmsg);
      this._updateViewport('bottom'); this._render(); this._scrollBottom();
      try {
        const resp = await fetch(getBase() + `/rooms/${this._roomId}/messages`, {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + this._token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ body })
        });
        if (!resp.ok) throw new Error('send failed');
        const real = await resp.json().catch(() => null);
        const i = this.messages.findIndex(m => m.id === tempId);
        if (i >= 0) {
          if (real && real.id && !this.messages.some(m => m.id === real.id)) this.messages[i] = real; // pending → реальное
          else this.messages.splice(i, 1); // SSE-эхо уже добавило реальное — убираем pending
        }
        this.messages.sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        this._updateViewport('bottom'); this._render(); this._scrollBottom();
        // Кешировать отправленное
        const sent = real && this.messages.find(m => m.id === real.id);
        if (sent) this._cacheMsg(sent);
      } catch(e) {
        console.error(e);
        const p = this.messages.find(m => m.id === tempId);
        if (p) { p._sending = false; p._failed = true; this._render(); } // пометить неудачу
      }
    };
    sendBtn.onclick = send;
    const autoGrow = () => {
      const scrollEl = this._root.querySelector('#scroll');
      const wasAtBottom = scrollEl && scrollEl.scrollTop + scrollEl.clientHeight + 10 >= scrollEl.scrollHeight;
      input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      if (wasAtBottom && scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } // Enter — отправка, Shift+Enter — перенос
      else if (e.key === 'Escape' && this._editingId) this._cancelEdit();
    };
    input.oninput = () => { autoGrow(); if (input.value.trim()) this._sendTyping(); };

    // Делегирование кликов по контекстному меню (на стабильном #list)
    list.onclick = (e) => {
      const box = e.target.closest('.att-box');
      if (box) { this._openLightbox(box.dataset.full, box.dataset.mime, box.querySelector('.att-img') || box); return; }
      const file = e.target.closest('.att-file');
      if (file) { this._downloadAtt(file.dataset.full, file.dataset.mime, file.dataset.name); return; }
      const sp = e.target.closest('.spoiler');
      if (sp) { sp.classList.add('revealed'); return; }
      const btn = e.target.closest('[data-act]');
      if (!btn) { if (this._menuFor) { this._menuFor = null; this._delConfirm = null; this._render(); } return; }
      const id = btn.getAttribute('data-id'), act = btn.getAttribute('data-act');
      if (act === 'menu') { this._menuFor = this._menuFor === id ? null : id; this._delConfirm = null; this._render(); }
      else if (act === 'edit') this._startEdit(id);
      else if (act === 'copy') this._doCopy(id);
      else if (act === 'del') { this._delConfirm = id; this._render(); }
      else if (act === 'delyes') this._doDelete(id);
      else if (act === 'delno') { this._delConfirm = null; this._render(); }
    };

    // Лайтбокс: клик по фону (не по картинке) закрывает
    const lightbox = this._root.querySelector('#lightbox');
    if (lightbox) lightbox.onclick = (e) => { if (!e.target.closest('.lb-img')) this._closeLightbox(); };

    // Шапка: кнопка назад → к списку комнат; клик по остальному → настройки комнаты
    const header = this._root.querySelector('#header');
    if (header) {
      header.onclick = (e) => {
        if (e.target.closest('#back')) { this.dispatchEvent(new CustomEvent('chat-view:back', { bubbles: true, composed: true })); return; }
        this.dispatchEvent(new CustomEvent('chat-view:open-info', { detail: { roomId: this._roomId }, bubbles: true, composed: true }));
      };
    }

    // Прикрепить картинку → диалог-превью перед отправкой
    const file = this._root.querySelector('#file');
    if (file) file.onchange = () => { this._openSendDialog(file.files); file.value = ''; };
    const sdSend = this._root.querySelector('#sd-send');
    const sdCancel = this._root.querySelector('#sd-cancel');
    const sdCap = this._root.querySelector('#sd-caption');
    if (sdSend) sdSend.onclick = () => this._confirmSendDialog();
    if (sdCancel) sdCancel.onclick = () => this._closeSendDialog();
    if (sdCap) sdCap.onkeydown = (e) => { if (e.key === 'Enter') this._confirmSendDialog(); else if (e.key === 'Escape') this._closeSendDialog(); };
    const sdFile = this._root.querySelector('#sd-file');
    if (sdFile) sdFile.onchange = () => { this._addDialogFiles(sdFile.files); sdFile.value = ''; };
    const sdPrev = this._root.querySelector('#sd-previews');
    if (sdPrev) sdPrev.onclick = (e) => {
      const del = e.target.closest('.sd-del');
      if (del) this._removeDialogItem(+del.getAttribute('data-idx'));
    };

    this._startTypingGC();
    this._built = true;
  }

  _updateFab() {
    const scrollEl = this._root.querySelector('#scroll');
    const fab = this._root.querySelector('#fab');
    if (!scrollEl || !fab) return;
    const atBottom = this._atNewestEdge() &&
      scrollEl.scrollTop + scrollEl.clientHeight + 50 >= scrollEl.scrollHeight;
    if (atBottom) this._newCount = 0; // догнал низ — сбрасываем счётчик новых
    fab.classList.toggle('visible', !atBottom);
    // Счётчик новых сообщений (как в telegram): число вместо стрелки
    const n = this._newCount || 0;
    fab.textContent = n > 0 ? (n > 99 ? '99+' : String(n)) : '↓';
    fab.classList.toggle('has-count', n > 0);
  }

  // ── Load ─────────────────────────────────────────────────
  async _init() {
    const gen = ++this._loadGen;
    try {
      // Показать каркас + скелетон СРАЗУ, не ждать ключ
      if (!this._built) { this._buildShell(); this._render(); }

      // Ключ грузим фоном — скелетон уже виден
      const keyPromise = this._loadKey();

      // Cache-first: показать закешированные сообщения мгновенно (telegram web)
      try {
        const { getMessages } = await import('./cache.js');
        const cached = await getMessages(this._roomId, 100);
        if (gen !== this._loadGen) return;
        if (cached.length > 0) {
          this.messages = cached;
          this.hasMoreOlder = true;
          this._updateViewport('bottom');
          this._render();
          this._scrollBottom();
          this._resolveNames();
        }
      } catch {}

      // Дождаться ключ перед расшифровкой сетевых данных
      await keyPromise;
      if (gen !== this._loadGen) return;

      // Сеть: авторитетные данные
      const msgs = await this._api(`/rooms/${this._roomId}/messages?limit=100`);
      if (gen !== this._loadGen) return;
      msgs.reverse();
      for (const m of msgs) m._plaintext = this._decrypt(m.body, m._plaintext);

      // Мерж: сеть выигрывает по одинаковым id
      const merged = new Map(this.messages.map(m => [m.id, m]));
      for (const m of msgs) merged.set(m.id, m);
      this.messages = [...merged.values()].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      this.hasMoreOlder = msgs.length >= 100;
      this._updateViewport('bottom');
      this._render();
      this._scrollBottom();
      this._initDone = true;

      // Сохранить в кеш
      this._cacheCurrent();

      // deltaFetch
      try {
        const more = await this._api(`/rooms/${this._roomId}/messages?limit=500`);
        if (gen !== this._loadGen) return;
        more.reverse();
        for (const m of more) m._plaintext = this._decrypt(m.body, m._plaintext);
        const merged2 = new Map(this.messages.map(m => [m.id, m]));
        for (const m of more) merged2.set(m.id, m);
        this.messages = [...merged2.values()].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        // hasMoreOlder по размеру ПОСЛЕДНЕЙ страницы (как в _loadOlder: data.length>=100),
        // а не по общему числу - иначе комната ровно из 500 неверно считалась «есть ещё».
        this.hasMoreOlder = more.length >= 500;
        if (this._pinBottom) { this._updateViewport('bottom'); this._render(); this._scrollBottom(); }
        this._cacheCurrent();
      } catch(e) { console.error('deltaFetch:', e); }

      // Reads + пометить последнее прочитанным (обнуляет unread в сайдбаре)
      try {
        const list = await this._api(`/rooms/${this._roomId}/reads`);
        for (const r of (list||[])) this.reads[r.user_id] = r.last_read;
      } catch(e) {}
      if (this.messages.length > 0) this._markRead(this.messages[this.messages.length - 1].id);
      await this._resolveNames(); // имена авторов + читателей
      this._render(); // обновить ✓✓ после загрузки reads
    } catch(e) {
      console.error('chat-view init:', e);
      this._root.innerHTML = `<div style="padding:20px;color:red">Ошибка: ${e.message}</div>`;
    }
  }

  // Записать текущие сообщения в IndexedDB (fire-and-forget)
  async _cacheCurrent() {
    try {
      const { putMessages } = await import('./cache.js');
      const items = this.messages.filter(m => m._plaintext !== undefined).map(m => ({ msg: m, plaintext: m._plaintext }));
      if (items.length) await putMessages(this._roomId, items);
    } catch {}
  }
  async _cacheMsg(m) {
    try {
      const { putMessage } = await import('./cache.js');
      if (m._plaintext === undefined) m._plaintext = this._decrypt(m.body, m._plaintext);
      await putMessage(this._roomId, m, m._plaintext);
    } catch {}
  }
  async _cacheRemove(msgId) {
    try { const { removeMessage } = await import('./cache.js'); await removeMessage(this._roomId, msgId); } catch {}
  }

  // Жест в полете: палец на экране, либо инерция после отпускания (scroll-события
  // продолжают сыпаться). В WKWebView (iOS) программный scrollTop во время жеста
  // ЗАТИРАЕТСЯ компоситором (проверено бенчем в симуляторе: restore 187→2907, через
  // кадр снова 175) → prepend+restore в этот момент = телепорт ленты на ±40 сообщений.
  // На десктопе тач-событий нет — всегда false, поведение не меняется.
  _gestureActive() {
    if (this._touchDown) return true;
    if (!this._lastTouchEnd) return false;
    const now = Date.now();
    return (now - (this._lastScrollEvt || 0) < 140) && (now - this._lastTouchEnd < 6000);
  }

  // Отложить fn до тишины скролла (конец жеста и инерции). Один таймер на ключ.
  _deferAtIdle(key, fn) {
    if (!this._idleTimers) this._idleTimers = {};
    if (this._idleTimers[key]) return;
    this._idleTimers[key] = setInterval(() => {
      if (this._gestureActive()) return;
      clearInterval(this._idleTimers[key]);
      this._idleTimers[key] = null;
      fn();
    }, 80);
  }

  _clearIdleTimers() {
    if (!this._idleTimers) return;
    for (const k of Object.keys(this._idleTimers)) {
      if (this._idleTimers[k]) { clearInterval(this._idleTimers[k]); this._idleTimers[k] = null; }
    }
  }

  async _loadOlder() {
    if (this._pinBottom) return;
    if (this.loadingOlder || this.messages.length === 0 || this.viewIds.length === 0) return;
    // Во время жеста/инерции не трогаем DOM — применим на тишине (WKWebView).
    if (this._gestureActive()) {
      this._deferAtIdle('older', () => { this._lastOlder = 0; this._loadOlder(); });
      return;
    }
    const now = Date.now();
    if (this._lastOlder && now - this._lastOlder < 500) return;
    this._lastOlder = now;
    this.loadingOlder = true;
    try {
      const ids = this._allIdsSorted();
      const firstIdx = ids.indexOf(this.viewIds[0]);
      // Локальные сообщения над окном кончились — тянем с сервера
      if (firstIdx <= 0) {
        if (!this.hasMoreOlder || ids.length === 0) return;
        const beforeId = ids[0];
        let data = [];
        // Cache-first: сначала IndexedDB
        try {
          const { getMessagesBefore } = await import('./cache.js');
          data = await getMessagesBefore(this._roomId, beforeId, 100);
        } catch {}
        if (data.length === 0) {
          data = await this._api(`/rooms/${this._roomId}/messages?before=${beforeId}&limit=100`);
          data.reverse();
          for (const m of data) m._plaintext = this._decrypt(m.body, m._plaintext);
          try {
            const { putMessages } = await import('./cache.js');
            const items = data.filter(m => m._plaintext !== undefined).map(m => ({ msg: m, plaintext: m._plaintext }));
            if (items.length) await putMessages(this._roomId, items);
          } catch {}
        }
        if (data.length === 0) { this.hasMoreOlder = false; this._render(); return; }
        const known = new Set(this.messages.map(m => m.id));
        const fresh = data.filter(m => !known.has(m.id));
        // Все сообщения уже есть локально — сервер отдал дубликаты.
        // Прекращаем грузить, иначе observer зациклится: hasMoreOlder=true,
        // _obsTop снова дёрнет _loadOlder → опять дубликаты → опять.
        if (fresh.length === 0) { this.hasMoreOlder = false; return; }
        this.messages = [...fresh, ...this.messages];
        this.hasMoreOlder = data.length >= 100;
      }
      const prevFirst = this.viewIds[0];
      this._updateViewport('older');
      if (this.viewIds[0] === prevFirst) return; // нечего показывать
      this._anchorData = this._anchor();
      this._render();
      this._resolveNames();
    } catch(e) { console.error('loadOlder:', e); }
    finally { this.loadingOlder = false; }
  }

  _shiftNewer() {
    if (this._atNewestEdge()) return;
    // Тот же WKWebView-защитный гейт, что и в _loadOlder
    if (this._gestureActive()) {
      this._deferAtIdle('newer', () => this._shiftNewer());
      return;
    }
    const prevLast = this.viewIds[this.viewIds.length - 1];
    this._updateViewport('newer');
    if (this.viewIds[this.viewIds.length - 1] === prevLast) return;
    this._anchorData = this._anchor(); // рендер восстановит скролл сразу после innerHTML
    this._render();
  }

  // Целевой scrollTop, чтобы якорь остался на том же экранном месте после сдвига
  // окна/DOM. currentTop - текущий scrollTop, newTop - позиция якоря относительно
  // контейнера СЕЙЧАС, aTop - та же позиция ДО сдвига.
  // target = currentTop + (newTop - aTop): двигаем скролл ровно на дельту смещения
  // якоря. Формула не зависит от промежуточных сбросов scrollTop (WKWebView).
  // Регрессия web-0.2.0: базовый currentTop был потерян → прыжок на -currentTop.
  _anchorTarget(currentTop, newTop, aTop) {
    return currentTop + newTop - aTop;
  }

  // Найти строку сообщения по id. Быстрый путь — querySelector; в WKWebView
  // Shadow DOM атрибутный селектор ненадёжен (возвращает null, хотя элемент в
  // DOM) — фоллбек ручным обходом children по dataset.msgid. Именно из-за этого
  // на мобиле рвался anchor-restore: querySelector=null → якорь не найден →
  // лента прыгала при подгрузке.
  _findMsgEl(scrollEl, id) {
    let el = null;
    try { el = scrollEl.querySelector(`[data-msgid="${id}"]`); } catch { el = null; }
    if (el) return el;
    const stack = [scrollEl];
    while (stack.length) {
      const node = stack.pop();
      const kids = node && node.children;
      if (!kids) continue;
      for (let i = 0; i < kids.length; i++) {
        const c = kids[i];
        if (c && c.dataset && c.dataset.msgid === id) {
          // Диагностика: querySelector промахнулся, обход нашёл → подтверждает
          // WKWebView-граблю. Включить: localStorage['sschat-scroll-debug']='1'.
          try { if (localStorage.getItem('sschat-scroll-debug') === '1') console.warn('[scroll] querySelector MISS → walk HIT', id); } catch {}
          return c;
        }
        stack.push(c);
      }
    }
    return null;
  }

  // Якорь: первый id из нового viewIds, существующий в текущем DOM, + его offset
  _anchor() {
    const scrollEl = this._root.querySelector('#scroll');
    if (!scrollEl) return null;
    const base = scrollEl.getBoundingClientRect().top;
    for (const id of this.viewIds) {
      const el = this._findMsgEl(scrollEl, id);
      if (el) return { id, top: el.getBoundingClientRect().top - base };
    }
    return null;
  }

  _scrollBottom() {
    const s = this._root.querySelector('#scroll');
    if (!s) return;
    this._pinBottom = true; this._atBottomFlag = true; // держим низ при последующих догрузках
    this._newCount = 0; // догнали низ — сброс счётчика новых на FAB
    s.scrollTop = s.scrollHeight;
    // sh растёт по мере декода картинок → дожимаем, но только пока пин активен
    // (юзер не ушёл вверх). rAF + 100мс догоняют прирост высоты без «отката».
    if (typeof requestAnimationFrame === 'function')
      requestAnimationFrame(() => { if (this._pinBottom) s.scrollTop = s.scrollHeight; });
    setTimeout(() => { if (this._pinBottom) s.scrollTop = s.scrollHeight; }, 100);
  }
  // Держать низ, если пин или пользователь был у нижнего края (после load картинки)
  _stickBottomIfNeeded() {
    if (this._pinBottom || (this._atBottomFlag && this._atNewestEdge())) {
      const s = this._root.querySelector('#scroll'); if (s) s.scrollTop = s.scrollHeight;
    }
  }

  // ── Helpers ──────────────────────────────────────────────
  _parseBody(body) {
    if (!body || !body.startsWith('{')) return body || '';
    try {
      const o = JSON.parse(body);
      if (Array.isArray(o.att) && o.att.length > 0) {
        return (o.caption || '') + ' 📎';
      }
    } catch {}
    return body;
  }
  // Вложения из расшифрованного тела: {caption, atts:[{id,mime,name,w,h,thumbId}]} | null
  _attachmentsOf(decrypted) {
    if (!decrypted || !decrypted.startsWith('{')) return null;
    let o; try { o = JSON.parse(decrypted); } catch { return null; }
    if (!Array.isArray(o.att) || o.att.length === 0) return null;
    return {
      caption: o.caption || '',
      atts: o.att.map(a => ({ id: a.id, mime: a.mime || 'application/octet-stream', name: a.name || '', w: a.w, h: a.h, size: a.size, thumbId: a.thumb?.id || a.id, blur: a.blur })),
    };
  }
  // HTML не-картиночного вложения: видео/аудио — inline-плеер, прочее — карточка со скачиванием
  _attFileHtml(a) {
    const kind = attKind(a);
    const mime = mimeFor(a); // корректный mime (расширение приоритетнее — pibot врёт image/png на mp4)
    if (kind === 'video') return `<video class="att-media" data-full="${a.id}" data-mime="${mime}" controls preload="metadata" playsinline></video>`;
    if (kind === 'audio') return `<audio class="att-media" data-full="${a.id}" data-mime="${mime}" controls preload="none"></audio>`;
    const ext = (a.name.split('.').pop() || '').slice(0, 4).toUpperCase();
    return `<div class="att-file" data-full="${a.id}" data-mime="${mime}" data-name="${escapeHtml(a.name)}" title="Скачать">
        <div class="att-file-icon">${ext || '📄'}</div>
        <div class="att-file-meta"><div class="att-file-name">${escapeHtml(a.name || 'файл')}</div><div class="att-file-size">${formatSize(a.size)}</div></div>
      </div>`;
  }
  // Скачать вложение (decrypt → download)
  async _downloadAtt(id, mime, name) {
    try {
      const url = await this._attUrl(id, mime);
      if (!url) return;
      const a = document.createElement('a');
      a.href = url; a.download = name || 'file';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { console.error('download:', e); }
  }

  // HTML одного вложения. style — CSS-строка размера/позиции.
  _attBoxHtml(a, style) {
    const hasThumb = a.thumbId !== a.id ? '1' : '0';
    const cached = this._attUrls && (this._attUrls.get(a.id) || this._attUrls.get(a.thumbId));
    const loadedAttr = cached ? ' data-loaded="1"' : '';
    const imgAttr = cached ? ` src="${cached}" class="att-img shown"` : ' class="att-img"';
    // blur-плейсхолдер виден мгновенно (если ещё не загружена реальная картинка)
    const blurLayer = (a.blur && !cached) ? `<div class="att-blur" style="background-image:url('${a.blur}')"></div>` : '';
    return `<div class="att-box" style="${style}" data-thumb="${a.thumbId}" data-full="${a.id}" data-mime="${a.mime}" data-hasthumb="${hasThumb}"${loadedAttr} title="${escapeHtml(a.name)}">
          ${blurLayer}<img${imgAttr} decoding="async" alt="${escapeHtml(a.name)}">
          <div class="att-progress${cached ? ' hidden' : ''}"><div class="att-bar"></div></div>
        </div>`;
  }

  // HTML оптимистичного превью при отправке (локальные objectURL + прогресс)
  _pendingHtml(m) {
    const ps = m._previews || [];
    const imgs = ps.filter(p => p.isImage), files = ps.filter(p => !p.isImage);
    let inner = '';
    if (imgs.length === 1) {
      const d = fitDimensions(imgs[0].w, imgs[0].h);
      const st = d ? `width:${d.w}px;height:${d.h}px` : 'width:200px;height:160px';
      inner += `<div class="att-box" data-loaded="1" style="${st}"><img class="att-img shown" src="${imgs[0].url}"></div>`;
    } else if (imgs.length > 1) {
      const lay = albumLayout(imgs.map(p => (p.w && p.h) ? p.w / p.h : 1));
      inner += `<div class="att-gallery" style="position:relative;width:${lay.width}px;height:${lay.height}px">${
        imgs.map((p, i) => { const r = lay.items[i];
          return `<div class="att-box" data-loaded="1" style="position:absolute;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px"><img class="att-img shown" src="${p.url}"></div>`;
        }).join('')}</div>`;
    }
    inner += files.map(p => {
      const ext = ((p.name || '').split('.').pop() || '').slice(0, 4).toUpperCase();
      return `<div class="att-file"><div class="att-file-icon">${ext || '📄'}</div><div class="att-file-meta"><div class="att-file-name">${escapeHtml(p.name || 'файл')}</div><div class="att-file-size">${formatSize(p.size)}</div></div></div>`;
    }).join('');
    const pct = Math.round((m._progress || 0) * 100);
    const cap = m._caption ? `<div class="msg-text">${escapeHtml(m._caption)}</div>` : '';
    // Текстовое сообщение (без вложений) — показываем текст сразу
    const textHtml = !inner && !cap && m.body ? `<div class="msg-text">${escapeHtml(this._decrypt(m.body, m._plaintext))}</div>` : '';
    return `<div class="msg-row mine">
      <div class="chat-bubble mine sending">
        ${inner ? `<div class="att-wrap att-sending">${inner}<div class="sending-overlay">Отправка ${pct}%</div></div>` : ''}
        ${cap}
        ${textHtml}
        <span class="time">${escapeHtml(new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}))} ${m._sending ? '<span class="status sending" title="Отправляется">🕐</span>' : '<span class="status failed" title="Не отправлено">⚠</span>'}</span>
      </div></div>`;
  }



  // IndexedDB-кэш расшифрованных байт (динамический import — не тянуть idb в терминал)
  async _idbStore() {
    if (this._idbStoreP) return this._idbStoreP;
    this._idbStoreP = (async () => {
      const { createStore } = await import('idb-keyval');
      return createStore('sschat-attachments', 'blobs');
    })();
    return this._idbStoreP;
  }
  async _idbGet(id) { try { const { get } = await import('idb-keyval'); return await get(id, await this._idbStore()); } catch { return null; } }
  async _idbSet(id, bytes) { try { const { set } = await import('idb-keyval'); await set(id, bytes, await this._idbStore()); } catch {} }

  // Скачать тело с прогрессом (ReadableStream). onProgress(frac 0..1).
  async _fetchWithProgress(url, onProgress) {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + this._token } });
    if (!r.ok) throw new Error(`att ${r.status}`);
    const total = +(r.headers.get('Content-Length') || 0);
    if (!r.body || !total) return new Uint8Array(await r.arrayBuffer()); // нет стрима/длины — разом
    const reader = r.body.getReader();
    const chunks = []; let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); received += value.length;
      if (onProgress) onProgress(received / total);
    }
    const out = new Uint8Array(received); let pos = 0;
    for (const c of chunks) { out.set(c, pos); pos += c.length; }
    return out;
  }

  // attId → blob URL. Кэш: память → IndexedDB → сеть+дешифровка. onProgress опц.
  async _attUrl(attId, mime, onProgress) {
    if (!this._attUrls) this._attUrls = new Map();
    if (this._attUrls.has(attId)) return this._attUrls.get(attId);
    // IndexedDB (расшифрованные байты — не качаем/не дешифруем повторно между сессиями)
    const cached = await this._idbGet(attId);
    if (cached) {
      const url = URL.createObjectURL(new Blob([cached], { type: mime }));
      this._attUrls.set(attId, url);
      return url;
    }
    if (!this._roomKeyRaw) return null;
    const enc = await this._fetchWithProgress(getBase() + `/rooms/${this._roomId}/attachments/${attId}`, onProgress);
    const plain = decryptBlob(enc, this._roomKeyRaw);
    if (!plain) return null;
    this._idbSet(attId, plain); // fire-and-forget
    const url = URL.createObjectURL(new Blob([plain], { type: mime }));
    this._attUrls.set(attId, url);
    return url;
  }
  // ── Отправка картинок ────────────────────────────────────
  // Загрузка зашифрованного блоба: direct (≤512KB) или чанками. → att-запись.
  // POST с ретраями и backoff (как pibot). 400 (body too large) не ретраим.
  async _postRetry(url, opts, retries = 3) {
    let last;
    for (let i = 0; i < retries; i++) {
      try {
        const r = await fetch(url, opts);
        if (r.ok) return r;
        if (r.status === 400) throw new Error('HTTP 400'); // не ретраить
        last = new Error('HTTP ' + r.status);
      } catch (e) { last = e; if (String(e.message).includes('400')) throw e; }
      if (i < retries - 1) await new Promise(res => setTimeout(res, 1000 * (i + 1)));
    }
    throw last;
  }

  // onProgress(frac 0..1) — по чанкам (chunked) или сразу 1 (direct)
  async _uploadBlob(bytes, mime, name, w, h, onProgress) {
    const enc = encryptBlob(bytes, this._roomKeyRaw); // nonce[12]+AES-GCM
    const CHUNK = 512 * 1024;
    const auth = { Authorization: 'Bearer ' + this._token };
    if (enc.length <= CHUNK) {
      const r = await this._postRetry(getBase() + `/rooms/${this._roomId}/attachments`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/octet-stream' }, body: enc });
      if (onProgress) onProgress(1);
      return { id: (await r.json()).attachment_id, mime, name, w, h };
    }
    const ir = await this._postRetry(getBase() + `/rooms/${this._roomId}/attachments/init`, { method: 'POST', headers: auth });
    const id = (await ir.json()).attachment_id;
    const total = Math.ceil(enc.length / CHUNK);
    for (let i = 0; i < total; i++) {
      const chunk = enc.subarray(i * CHUNK, Math.min((i + 1) * CHUNK, enc.length));
      await this._postRetry(getBase() + `/rooms/${this._roomId}/attachments/${id}/chunks?chunk=${i}&total=${total}`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/octet-stream' }, body: chunk });
      if (onProgress) onProgress((i + 1) / total);
    }
    return { id, mime, name, w, h };
  }

  // Крошечный base64-preview (~24px JPEG) для мгновенного blur-плейсхолдера
  _genBlur(bmp) {
    const W = 24, H = Math.max(1, Math.round(W * bmp.height / bmp.width));
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    canvas.getContext('2d').drawImage(bmp, 0, 0, W, H);
    return canvas.toDataURL('image/jpeg', 0.4); // data:image/jpeg;base64,... ~0.5-1KB
  }

  // Thumbnail через canvas (≤320px), null если картинка уже мелкая
  async _genThumb(bmp) {
    const max = 320;
    if (bmp.width <= max && bmp.height <= max) return null;
    const r = Math.min(max / bmp.width, max / bmp.height);
    const w = Math.round(bmp.width * r), h = Math.round(bmp.height * r);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.75));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h, mime: 'image/jpeg' };
  }

  // Загрузить файл → att-запись. Картинки: thumb/blur/w-h. Прочее: size для карточки.
  // onProgress(frac 0..1) по full.
  async _uploadImage(file, onProgress) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = file.type || 'application/octet-stream';
    const att = await this._uploadBlob(bytes, mime, file.name, undefined, undefined, onProgress);
    att.size = bytes.length; // размер для карточки файла
    if (mime.startsWith('image/')) {
      try {
        const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
        att.w = bmp.width; att.h = bmp.height;
        try { att.blur = this._genBlur(bmp); } catch {} // мгновенный blur-плейсхолдер
        const t = await this._genThumb(bmp);
        if (t) {
          const tb = await this._uploadBlob(t.bytes, t.mime, (file.name || 'img') + '_thumb.jpg', t.w, t.h);
          att.thumb = { id: tb.id, mime: tb.mime, w: tb.w, h: tb.h };
        }
      } catch (e) { console.error('image meta:', e); }
    }
    return att;
  }

  // Вставка картинки из буфера (Ctrl+V скриншота)
  _handlePaste(e) {
    if (!this._roomId || !this._roomKeyRaw) return;
    const items = (e.clipboardData && e.clipboardData.items) || [];
    const files = [];
    for (const it of items) if (it.type && it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) files.push(f); }
    if (files.length) { e.preventDefault(); this._openSendDialog(files); }
  }

  // ── Диалог отправки/редактирования галереи (как telegram web) ──
  // Единая модель: _dlgItems = [{kind:'file',file,url} | {kind:'att',att}]
  _openSendDialog(files) {
    const list = [...(files || [])].filter(f => f && (f.name || f.type));
    if (!this._roomKeyRaw || !list.length) return;
    this._dlgMode = 'send'; this._editMsgId = null;
    this._dlgItems = list.map(f => ({ kind: 'file', file: f, url: URL.createObjectURL(f) }));
    const cap = this._root.querySelector('#sd-caption');
    const input = this._root.querySelector('#input');
    if (cap) cap.value = input ? input.value.trim() : '';
    if (input) input.value = '';
    this._renderDialog();
    if (cap) cap.focus();
  }
  _openEditDialog(id) {
    const m = this.messages.find(x => x.id === id);
    if (!m) return false;
    const dec = this._decrypt(m.body, m._plaintext);
    let o; try { o = JSON.parse(dec); } catch { return false; }
    if (!Array.isArray(o.att) || !o.att.length) return false;
    this._dlgMode = 'edit'; this._editMsgId = id;
    this._dlgItems = o.att.map(a => ({ kind: 'att', att: a }));
    const cap = this._root.querySelector('#sd-caption');
    if (cap) cap.value = o.caption || '';
    this._renderDialog();
    if (cap) cap.focus();
    return true;
  }
  // Перерисовать заголовок + превью (вызывается при открытии/добавлении/удалении)
  _renderDialog() {
    const items = this._dlgItems || [];
    const dlg = this._root.querySelector('#send-dialog');
    const prev = this._root.querySelector('#sd-previews');
    const title = this._root.querySelector('#sd-title');
    const send = this._root.querySelector('#sd-send');
    if (send) send.textContent = this._dlgMode === 'edit' ? 'Сохранить' : 'Отправить';
    if (title) title.textContent = this._dlgMode === 'edit'
      ? 'Редактировать' : (items.length === 1 ? 'Отправить картинку' : `Отправить ${items.length} картинок`);
    if (prev) {
      const canDelete = items.length > 1; // последнюю картинку убрать нельзя (как telegram web)
      prev.innerHTML = items.map((it, i) => {
        const mime = it.kind === 'file' ? (it.file.type || '') : (it.att.mime || '');
        const name = it.kind === 'file' ? it.file.name : it.att.name;
        const del = canDelete ? `<button class="sd-del" data-idx="${i}" title="Удалить"><svg viewBox="0 0 14 14" width="11" height="11"><path d="M2 2L12 12M12 2L2 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>` : '';
        let media;
        if (mime.startsWith('image/')) {
          const src = it.kind === 'file' ? ` src="${it.url}"` : '';
          const data = it.kind === 'att' ? ` data-att="${it.att.thumb?.id || it.att.id}" data-mime="${mime || 'image/jpeg'}"` : '';
          media = `<img class="sd-thumb"${src}${data}>`;
        } else {
          const ext = ((name || '').split('.').pop() || '').slice(0, 4).toUpperCase();
          media = `<div class="sd-thumb sd-fileicon">${ext || '📄'}<span>${escapeHtml(name || 'файл')}</span></div>`;
        }
        return `<div class="sd-item">${media}${del}</div>`;
      }).join('');
      for (const img of prev.querySelectorAll('.sd-thumb[data-att]')) {
        this._attUrl(img.dataset.att, img.dataset.mime).then(u => { if (u) img.src = u; }).catch(() => {});
      }
    }
    if (dlg) dlg.classList.add('visible');
  }
  _addDialogFiles(files) {
    const list = [...(files || [])].filter(f => f && (f.name || f.type));
    if (!list.length || !this._dlgItems) return;
    for (const f of list) this._dlgItems.push({ kind: 'file', file: f, url: URL.createObjectURL(f) });
    this._renderDialog();
  }
  _removeDialogItem(idx) {
    if (!this._dlgItems || idx < 0 || idx >= this._dlgItems.length) return;
    const it = this._dlgItems[idx];
    if (it.url) { try { URL.revokeObjectURL(it.url); } catch {} }
    this._dlgItems.splice(idx, 1);
    if (this._dlgItems.length === 0) { this._closeSendDialog(); return; } // не осталось картинок
    this._renderDialog();
  }
  _closeSendDialog() {
    const dlg = this._root.querySelector('#send-dialog');
    if (dlg) dlg.classList.remove('visible');
    (this._dlgItems || []).forEach(it => { if (it.url) { try { URL.revokeObjectURL(it.url); } catch {} } });
    this._dlgItems = null; this._dlgMode = null; this._editMsgId = null;
  }
  // Подтверждение: send → новое сообщение, edit → PATCH с собранным att[]
  async _confirmSendDialog() {
    const items = this._dlgItems || [];
    const cap = this._root.querySelector('#sd-caption');
    const caption = cap ? cap.value.trim() : '';
    if (this._dlgMode === 'edit') {
      const id = this._editMsgId;
      const files = items.filter(it => it.kind === 'file');
      const existing = items.filter(it => it.kind === 'att');
      this._closeSendDialog();
      if (!id || (!files.length && !existing.length)) return;
      try {
        const atts = [];
        for (const it of items) { // сохраняем порядок
          if (it.kind === 'att') atts.push(it.att);
          else { const a = await this._uploadImage(it.file); if (a) atts.push(a); }
        }
        if (!atts.length) return;
        const body = encryptBody(JSON.stringify({ caption, att: atts }), this._roomKeyRaw);
        const r = await fetch(getBase() + `/rooms/${this._roomId}/messages/${id}`, {
          method: 'PATCH', headers: { 'Authorization': 'Bearer ' + this._token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ body }) });
        if (!r.ok) throw new Error(`edit ${r.status}`);
      } catch (e) { console.error('saveEdit:', e); }
      return;
    }
    // send: все элементы — file
    const files = items.filter(it => it.kind === 'file').map(it => it.file);
    this._closeSendDialog();
    if (files.length) this._sendImages(files, caption);
  }

  // Загрузить файлы → оптимистичное превью в ленте → сообщение с att[]
  async _sendImages(files, captionArg) {
    const list = [...(files || [])].filter(f => f && (f.name || f.type));
    if (!this._roomKeyRaw || !list.length) return;
    const input = this._root.querySelector('#input');
    const caption = captionArg !== undefined ? captionArg : (input ? input.value.trim() : '');
    if (captionArg === undefined && input) input.value = '';

    // 1. Локальные превью (objectURL + размеры) → pending-сообщение сразу в ленту
    const previews = [];
    for (const f of list) {
      const isImg = (f.type || '').startsWith('image/');
      let w, h;
      if (isImg) { try { const b = await createImageBitmap(f); w = b.width; h = b.height; b.close && b.close(); } catch {} }
      previews.push({ url: URL.createObjectURL(f), w, h, name: f.name, mime: f.type, size: f.size, isImage: isImg });
    }
    const tempId = 'pending-' + String(++this._pendingSeq).padStart(20, '0'); // сортируется в конец (после ULID)
    const pmsg = { id: tempId, user_id: this._userId, created_at: new Date().toISOString(),
      _pending: true, _previews: previews, _caption: caption, _progress: 0 };
    this.messages.push(pmsg);
    this._updateViewport('bottom'); this._render(); this._scrollBottom();

    // 2. Загрузка — прогресс по реальным байтам (frac внутри файла + завершённые)
    try {
      const atts = [];
      let lastRender = 0;
      const tick = () => { const now = Date.now(); if (now - lastRender > 150) { lastRender = now; this._render(); } };
      for (let i = 0; i < list.length; i++) {
        const a = await this._uploadImage(list[i], (frac) => {
          pmsg._progress = (i + frac) / list.length; tick();
        });
        if (a) atts.push(a);
        pmsg._progress = (i + 1) / list.length; this._render();
      }
      if (!atts.length) { this._removePending(pmsg); return; }
      pmsg._attIds = new Set(atts.map(a => a.id)); // для дедупа при SSE-эхо
      const body = encryptBody(JSON.stringify({ caption, att: atts }), this._roomKeyRaw);
      await fetch(getBase() + `/rooms/${this._roomId}/messages`, {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + this._token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }) });
      // pending снимется в _handleIncoming когда придёт реальное сообщение по SSE
    } catch (e) { console.error('sendImages:', e); this._removePending(pmsg); }
  }

  _removePending(pmsg) {
    const i = this.messages.indexOf(pmsg);
    if (i < 0) return;
    (pmsg._previews || []).forEach(p => { try { URL.revokeObjectURL(p.url); } catch {} });
    this.messages.splice(i, 1);
    this._updateViewport(this._atNewestEdge() ? 'bottom' : 'older'); this._render();
  }

  // ── Лайтбокс: навигация + FLIP + зум/пан ─────────────────
  // Все картинки чата по порядку (для свайпа ←→)
  _lbCollect() {
    const out = [];
    const ids = this._allIdsSorted();
    for (const id of ids) {
      const m = this.messages.find(x => x.id === id);
      if (!m || m._pending) continue;
      const a = this._attachmentsOf(this._decrypt(m.body, m._plaintext));
      if (a) for (const x of a.atts) out.push({ id: x.id, mime: x.mime });
    }
    return out;
  }
  _lbClampScale(s) { return Math.max(1, Math.min(4, s)); }

  async _openLightbox(attId, mime, fromEl) {
    const box = this._root.querySelector('#lightbox');
    if (!box) return;
    this._lbList = this._lbCollect();
    this._lbIndex = Math.max(0, this._lbList.findIndex(x => x.id === attId));
    if (this._lbList.length === 0) this._lbList = [{ id: attId, mime }];
    this._lbFromRect = fromEl && fromEl.getBoundingClientRect ? fromEl.getBoundingClientRect() : null;
    this._lightboxOpen = true;
    box.classList.add('visible');
    const svg = (p) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="${p}"/></svg>`;
    box.innerHTML = `
      <button class="lb-close" data-lb="close" title="Закрыть">${svg('M18 6 6 18M6 6l12 12')}</button>
      <button class="lb-nav lb-prev" data-lb="prev" title="Назад">${svg('M15 18l-6-6 6-6')}</button>
      <img class="lb-img" alt="">
      <button class="lb-nav lb-next" data-lb="next" title="Вперёд">${svg('M9 18l6-6-6-6')}</button>`;
    this._lbBind(box);
    await this._lbShow(true);
  }
  _lbBind(box) {
    box.onclick = (e) => {
      const b = e.target.closest('[data-lb]');
      if (b) { const a = b.getAttribute('data-lb'); if (a === 'close') this._closeLightbox(); else if (a === 'prev') this._lbGo(-1); else if (a === 'next') this._lbGo(1); return; }
      if (!e.target.closest('.lb-img')) this._closeLightbox(); // клик по фону
    };
    const img = box.querySelector('.lb-img');
    // Зум колесом
    box.onwheel = (e) => { e.preventDefault(); this._lbScale = this._lbClampScale((this._lbScale || 1) * (e.deltaY < 0 ? 1.2 : 1 / 1.2)); if (this._lbScale === 1) { this._lbX = 0; this._lbY = 0; } this._lbApplyTransform(); };
    // Двойной клик — toggle zoom
    if (img) img.ondblclick = () => { this._lbScale = (this._lbScale || 1) > 1 ? 1 : 2.5; this._lbX = 0; this._lbY = 0; this._lbApplyTransform(); };
    // Пан перетаскиванием (при зуме) — desktop pointer events
    let dragging = false, sx = 0, sy = 0;
    if (img) {
      img.onpointerdown = (e) => { if ((this._lbScale || 1) <= 1) return; dragging = true; sx = e.clientX - (this._lbX || 0); sy = e.clientY - (this._lbY || 0); img.setPointerCapture?.(e.pointerId); };
      img.onpointermove = (e) => { if (!dragging) return; this._lbX = e.clientX - sx; this._lbY = e.clientY - sy; this._lbApplyTransform(); };
      img.onpointerup = () => { dragging = false; };
    }
    // Pinch-to-zoom для мобильных (touch events)
    if (!box.addEventListener) return;
    let pinchDist0 = 0, pinchScale0 = 1, pinchMid0 = { x: 0, y: 0 }, pinchX0 = 0, pinchY0 = 0;
    box.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const img = box.querySelector('.lb-img');
        if (img) img.style.transition = 'none'; // без анимации во время жеста
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchDist0 = Math.hypot(dx, dy);
        pinchScale0 = this._lbScale || 1;
        pinchMid0 = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
        pinchX0 = this._lbX || 0; pinchY0 = this._lbY || 0;
      }
    }, { passive: false });
    box.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        if (pinchDist0 > 0) {
          const s = this._lbClampScale(pinchScale0 * dist / pinchDist0);
          const mid = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
          // zoom относительно midpoint: смещение = старое + (mid - mid0)
          this._lbScale = s;
          this._lbX = pinchX0 + (mid.x - pinchMid0.x);
          this._lbY = pinchY0 + (mid.y - pinchMid0.y);
          this._lbApplyTransform();
        }
      }
    }, { passive: false });
    box.addEventListener('touchend', () => {
      pinchDist0 = 0;
      if ((this._lbScale || 1) <= 1.05) { this._lbScale = 1; this._lbX = 0; this._lbY = 0; this._lbApplyTransform(); }
    });
  }
  _lbApplyTransform() {
    const img = this._root.querySelector('#lightbox .lb-img');
    if (img) { img.style.transition = 'none'; img.style.transform = `translate(${this._lbX || 0}px, ${this._lbY || 0}px) scale(${this._lbScale || 1})`; }
  }
  _lbGo(delta) {
    const n = this._lbList.length;
    const ni = Math.max(0, Math.min(n - 1, this._lbIndex + delta));
    if (ni === this._lbIndex) return;
    this._lbIndex = ni; this._lbFromRect = null; // навигация — без FLIP
    return this._lbShow(false);
  }
  async _lbShow(flip) {
    const box = this._root.querySelector('#lightbox');
    const img = box && box.querySelector('.lb-img');
    if (!img) return;
    this._lbScale = 1; this._lbX = 0; this._lbY = 0; img.style.transition = 'none'; img.style.transform = '';
    // видимость стрелок
    const prev = box.querySelector('.lb-prev'), next = box.querySelector('.lb-next');
    if (prev) prev.style.display = this._lbIndex > 0 ? '' : 'none';
    if (next) next.style.display = this._lbIndex < this._lbList.length - 1 ? '' : 'none';
    const att = this._lbList[this._lbIndex];
    try {
      const url = await this._attUrl(att.id, att.mime);
      if (!this._lightboxOpen) return;
      if (!url) { img.alt = 'Не удалось загрузить'; return; }
      img.src = url;
      if (flip && this._lbFromRect) this._lbFlip(img, this._lbFromRect);
    } catch (e) { console.error('lightbox:', e); }
  }
  // FLIP: анимация «вылет из миниатюры» (First-Last-Invert-Play)
  _lbFlip(img, from) {
    const run = () => {
      const to = img.getBoundingClientRect();
      if (!to.width || !to.height) return;
      const dx = (from.left + from.width / 2) - (to.left + to.width / 2);
      const dy = (from.top + from.height / 2) - (to.top + to.height / 2);
      const s = Math.max(0.05, from.width / to.width);
      img.style.transition = 'none';
      img.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
      requestAnimationFrame(() => {
        img.style.transition = 'transform .25s ease';
        img.style.transform = '';
        const onEnd = () => { img.style.transition = 'none'; img.removeEventListener('transitionend', onEnd); };
        img.addEventListener('transitionend', onEnd);
      });
    };
    if (img.complete && img.naturalWidth) run(); else img.addEventListener('load', run, { once: true });
  }
  _closeLightbox() {
    this._lightboxOpen = false;
    const box = this._root.querySelector('#lightbox');
    if (box) { box.classList.remove('visible'); box.innerHTML = ''; }
  }

  _loadAttachmentMedia(el) {
    el.dataset.loading = '1';
    this._attUrl(el.dataset.full, el.dataset.mime).then(u => {
      delete el.dataset.loading; el.dataset.loaded = '1';
      if (u) el.src = u;
    }).catch(e => { delete el.dataset.loading; el.dataset.loaded = '1'; console.error('media:', e); });
  }

  // Поиск первого ребёнка с классом cls (без querySelector — WKWebView bug)
  _childByClass(el, cls) {
    if (!el || !el.children) return null;
    for (const c of el.children) {
      if (c.className && (' ' + c.className + ' ').indexOf(' ' + cls + ' ') !== -1) return c;
      const found = this._childByClass(c, cls);
      if (found) return found;
    }
    return null;
  }

  _loadAttachmentBox(box) {
    // data-loading: загрузка начата, но ещё не завершена.
    // data-loaded ставится только в reveal()/fail() — по факту завершения.
    box.dataset.loading = '1';
    const { thumb: thumbId, full: fullId, mime, hasthumb } = box.dataset;
    const img = this._childByClass(box, 'att-img');
    const bar = this._childByClass(box, 'att-bar');
    const prog = this._childByClass(box, 'att-progress');
    const done = () => { delete box.dataset.loading; box.dataset.loaded = '1'; };
    const reveal = () => { done(); if (img) img.classList.add('shown'); if (prog) prog.classList.add('hidden'); this._stickBottomIfNeeded(); };
    const show = (u) => {
      if (!u || !img) { done(); return; }
      img.src = u;
      if (img.decode) img.decode().then(reveal).catch(reveal);
      else img.addEventListener('load', reveal, { once: true });
    };
    const fail = () => {
      done();
      if (prog) prog.classList.add('hidden');
      box.insertAdjacentHTML('beforeend', '<div class="att-fail">⚠ не удалось</div>');
      box.classList.add('att-broken');
    };
    if (hasthumb === '1') {
      if (prog) prog.classList.add('hidden');
      this._attUrl(thumbId, mime).then(u => u ? show(u) : null).catch(e => console.error('att thumb:', e));
      this._attUrl(fullId, mime).then(u => u ? show(u) : fail()).catch(e => { console.error('att full:', e); fail(); });
    } else {
      const onProgress = (f) => { if (bar) bar.style.width = Math.round(f * 100) + '%'; };
      this._attUrl(fullId, mime, onProgress).then(u => u ? show(u) : fail()).catch(e => { console.error('att full:', e); fail(); });
    }
  }

  _readersOf(msgId) {
    const readers = [];
    for (const [uid, last] of Object.entries(this.reads)) {
      if (uid !== this._userId && last >= msgId) readers.push(this.names[uid] ?? uid.slice(0,8));
    }
    return readers;
  }
}

customElements.define('chat-view', ChatView);
