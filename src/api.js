// api.js — HTTP-клиент для sschat сервера (замена Tauri invoke на fetch)
import { BUILD_INFO } from './build-info.js';

// Адрес сервера: сборочный VITE_API_BASE (см. .env.example), поверх него —
// runtime-переопределение из настроек (localStorage). Пусто → login-экран
// попросит ввести адрес вручную.
const DEFAULT_BASE = import.meta.env?.VITE_API_BASE || '';
const BASE = (() => {
  try { return localStorage.getItem('sschat-base-url') || DEFAULT_BASE; }
  catch { return DEFAULT_BASE; }
})();

export function setBaseURL(url) {
  try { localStorage.setItem('sschat-base-url', url); } catch {}
}

export function getToken() {
  try { return localStorage.getItem('sschat-token'); } catch { return null; }
}

export function setToken(t) {
  try { localStorage.setItem('sschat-token', t); } catch {}
}

async function request(method, path, body) {
  const headers = { 'Authorization': `Bearer ${getToken()}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const resp = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await resp.text();
  if (!resp.ok) {
    let msg = text;
    try { msg = JSON.parse(text).error || text; } catch {}
    throw new Error(`${method} ${path} → ${resp.status}: ${msg}`);
  }
  return text ? JSON.parse(text) : null;
}

async function get(path) { return request('GET', path); }
async function post(path, body) { return request('POST', path, body); }
async function patch(path, body) { return request('PATCH', path, body); }
async function del(path) { return request('DELETE', path); }

// --- E2E roomKey cache (разделяется между компонентами) ---
let _identityPriv = null;
let _userId = null;
const _roomKeys = new Map();
const _roomKeyNotFound = new Set();

export function setIdentity(priv, uid) { _identityPriv = priv; _userId = uid; }
export function getIdentity() { return _identityPriv; }
export function setRoomKey(roomId, key) { _roomKeys.set(roomId, key); }
export function getRoomKey(roomId) { return _roomKeys.get(roomId); }

async function _ensureRoomKey(roomId) {
  if (_roomKeys.has(roomId)) return _roomKeys.get(roomId);
  if (_roomKeyNotFound.has(roomId)) return null;
  if (!_identityPriv) return null;
  try {
    const { ensureRoomKey } = await import('./room-key.js');
    const key = await ensureRoomKey(roomId, _identityPriv);
    if (key) {
      _roomKeys.set(roomId, key);
      // First time we get a key — distribute to all members
      api.redistributeRoomKey(roomId).catch(() => {});
      return key;
    }
    _roomKeyNotFound.add(roomId);
  } catch {}
  return null;
}

async function _createRoomKey(roomId) {
  console.log('_createRoomKey called, identityPriv:', !!_identityPriv, 'userId:', !!_userId);
  if (!_identityPriv || !_userId) {
    console.error('_createRoomKey: no identity or userId — key NOT created!');
    return;
  }
  const roomKey = crypto.getRandomValues(new Uint8Array(32));
  const { deriveKEK } = await import('./crypto.js');
  const { loadOrCreateIdentity } = await import('./identity.js');
  const id = await loadOrCreateIdentity();
  const pub = id.pub;

  const kek = deriveKEK(id.priv, pub, roomId);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const { gcm } = await import('@noble/ciphers/aes.js');
  const wrapped = gcm(kek, nonce).encrypt(roomKey);

  await post(`/rooms/${roomId}/keys`, [{
    user_id: _userId,
    wrapped: btoa(String.fromCharCode(...wrapped)),
    nonce: btoa(String.fromCharCode(...nonce)),
    sender_pub: btoa(String.fromCharCode(...pub)),
  }]);

  const cryptoKey = await crypto.subtle.importKey('raw', roomKey, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  _roomKeys.set(roomId, { key: cryptoKey, raw: roomKey });
  console.log('room key created for', roomId.slice(0,8));
  // Wrap for all room members
  api.redistributeRoomKey(roomId).catch(() => {});
}

async function _retryRoomKeyInBackground(roomId) {
  const { ensureRoomKey } = await import('./room-key.js');
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const key = await ensureRoomKey(roomId, _identityPriv);
      if (key) {
        _roomKeys.set(roomId, key);
        // Триггерим перерисовку через кастомное событие
        window.dispatchEvent(new CustomEvent('sschat:roomkey_ready', { detail: { roomId } }));
        return;
      }
    } catch {}
  }
}

export const api = {
  setBaseURL: (url) => { try { localStorage.setItem('sschat-base-url', url); } catch {} },

  // State (бывший Tauri getState)
  getState: async () => {
    const token = getToken();
    if (!token) return { baseURL: BASE, authenticated: false, me: null };
    try {
      const me = await get('/me');
      return { baseURL: BASE, authenticated: true, me };
    } catch {
      setToken(null);
      return { baseURL: BASE, authenticated: false, me: null };
    }
  },

  // Build info
  getClientVersion: () => BUILD_INFO,
  // Auth
  getServerSettings: () => get('/settings'),
  login: (username, password) => post('/login', { username, password }),
  submitCode: async (challengeId, code) => {
    const cid = (typeof challengeId === 'string' ? challengeId : challengeId?.challenge_id) || challengeId;
    const resp = await post('/auth/code', { challenge_id: cid, code, device_name: 'sschat-web', platform: 'web' });
    if (resp.token) { setToken(resp.token); }
    return resp;
  },
  logout: () => { try { localStorage.removeItem('sschat-token'); } catch {} },
  me: () => get('/me'),

  // Rooms
  listRooms: () => get('/rooms?limit=200'),
  createRoom: async (name) => {
    const room = await post('/rooms', { name });
    // Генерируем и распространяем room key для новой комнаты
    _createRoomKey(room.id).catch(e => console.error('createRoomKey failed:', e));
    return room;
  },
  deleteRoom: (id) => del(`/rooms/${id}`),

  // Messages
  loadOlderMessages: async (roomId, beforeId, limit = 100) => {
    const msgs = await get(`/rooms/${roomId}/messages?before=${beforeId}&limit=${limit}`);
    const rkEntry = _roomKeys.get(roomId) || await _ensureRoomKey(roomId);
    const rk = rkEntry?.raw || rkEntry?.key || rkEntry;
    const { decryptBody } = await import('./crypto.js');
    const decrypted = [];
    for (const m of msgs) {
      if (rk) {
        decrypted.push(decryptBody(m.body, rk) || '•••');
      } else {
        decrypted.push(m.body?.startsWith('{') ? '•••' : (m.body || ''));
      }
    }
    return { messages: msgs, decrypted, has_more_older: msgs.length >= limit };
  },

  loadMessages: async (roomId, opts = {}) => {
    let q = `limit=${opts.limit || 50}`;
    if (opts.before) q += `&before=${opts.before}`;
    if (opts.after) q += `&after=${opts.after}`;
    const msgs = await get(`/rooms/${roomId}/messages?${q}`);
    // Расшифровываем (как Rust load_messages)
    const rkEntry = _roomKeys.get(roomId) || await _ensureRoomKey(roomId);
    const rk = rkEntry?.raw || rkEntry?.key || rkEntry; // raw bytes for @noble/ciphers
    const { decryptBody } = await import('./crypto.js');
    const decrypted = [];
    for (const m of msgs) {
      if (rk) {
        const plain = decryptBody(m.body, rk);
        decrypted.push(plain || '•••');
      } else {
        decrypted.push(m.body?.startsWith('{') ? '•••' : (m.body || ''));
      }
    }
    msgs.reverse(); // сервер отдаёт newest-first, клиент ждёт oldest-first
    return { messages: msgs, decrypted, from_cache: false, has_more_older: msgs.length >= (opts.limit || 50) };
  },
  sendMessage: (roomId, body) => post(`/rooms/${roomId}/messages`, { body }),
  editMessage: (roomId, msgId, body) => patch(`/rooms/${roomId}/messages/${msgId}`, { body }),
  deleteMessage: (roomId, msgId) => del(`/rooms/${roomId}/messages/${msgId}`),
  markRead: (roomId, msgId) => post(`/rooms/${roomId}/read`, { msg_id: msgId }),
  sendTyping: (roomId) => post(`/rooms/${roomId}/typing`, {}).catch(() => {}),
  muteRoom: (roomId) => put(`/rooms/${roomId}/mute`, {}),
  unmuteRoom: (roomId) => del(`/rooms/${roomId}/mute`),

  // Sync
  deltaFetchMessages: async (roomId) => {
    // Как в десктопе: fetch messages after latest_cached_id
    const { getRoomMeta } = await import('./cache.js');
    const meta = await getRoomMeta(roomId);
    const last = meta.latest_cached_id;
    return api.loadMessages(roomId, { after: last || '', limit: 500 });
  },
  syncMessages: (roomId, since) => get(`/rooms/${roomId}/sync?since=${since}&limit=200`),

  // Users & Members
  listUsers: () => get('/users'),
  getUser: (id) => get(`/users/${id}`),
  listRoomMembers: (roomId) => get(`/rooms/${roomId}/members`),
  addMemberToRoom: (roomId, userId) => post(`/rooms/${roomId}/members/${userId}`),
  removeMemberFromRoom: (roomId, userId) => del(`/rooms/${roomId}/members/${userId}`),
  setMemberRole: (roomId, userId, role) => patch(`/rooms/${roomId}/members/${userId}`, { role }),

  // Devices
  registerDevice: (pubKey) => post('/devices', { pub_key: pubKey, platform: 'web', name: 'sschat-web' }),
  listMyDevices: () => get('/devices'),
  deleteDevice: (id) => del(`/devices/${id}`),

  // Bots
  listBots: () => get('/bots'),
  createBot: (username, displayName) => post('/bots', { username, display_name: displayName }),
  deleteBot: (id) => del(`/bots/${id}`),
  regenerateBotToken: (id) => post(`/bots/${id}/regenerate-token`),
  listRoomBots: (roomId) => get(`/rooms/${roomId}/bots`),
  addBotToRoom: (roomId, botId) => post(`/rooms/${roomId}/bots/${botId}`),
  removeBotFromRoom: (roomId, botId) => del(`/rooms/${roomId}/bots/${botId}`),

  // Attachments
  uploadAttachment: async (roomId, encryptedBytes) => {
    const resp = await fetch(BASE + `/rooms/${roomId}/attachments`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/octet-stream' },
      body: encryptedBytes,
    });
    if (!resp.ok) throw new Error(`upload → ${resp.status}`);
    const { attachment_id } = await resp.json();
    return attachment_id;
  },
  downloadAttachment: async (roomId, attId) => {
    const resp = await fetch(BASE + `/rooms/${roomId}/attachments/${attId}`, {
      headers: { 'Authorization': `Bearer ${getToken()}` },
    });
    if (!resp.ok) throw new Error(`download → ${resp.status}`);
    return new Uint8Array(await resp.arrayBuffer());
  },

  // Room avatar (публичное фото комнаты, как в Telegram)
  uploadRoomAvatar: async (roomId, imageBytes) => {
    const resp = await fetch(BASE + `/rooms/${roomId}/avatar`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/octet-stream' },
      body: imageBytes,
    });
    if (!resp.ok) throw new Error(`avatar upload → ${resp.status}`);
    return resp.json();
  },
  getRoomAvatarUrl: (roomId) => `${BASE}/rooms/${roomId}/avatar`,
  deleteRoomAvatar: async (roomId) => {
    const resp = await fetch(BASE + `/rooms/${roomId}/avatar`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${getToken()}` },
    });
    if (!resp.ok) throw new Error(`avatar delete → ${resp.status}`);
    return resp.json();
  },

  // Room keys (E2E)
  getMyRoomKey: async (roomId) => {
    const resp = await get(`/rooms/${roomId}/keys/me`);
    console.log('getMyRoomKey', roomId.slice(0,8), '→', resp ? 'ok' : 'null', 'wrapped:', !!resp?.wrapped);
    return resp;
  },
  uploadRoomKeys: (roomId, keys) => post(`/rooms/${roomId}/keys`, keys),

  // Identity backup
  getIdentityBackup: () => get('/me/identity-backup'),
  saveIdentityBackup: (blob) => post('/me/identity-backup', blob),
  deleteIdentityBackup: () => del('/me/identity-backup'),

  // Password
  changePassword: (oldPassword, newPassword) => post('/me/password', { old_password: oldPassword, new_password: newPassword }),

  // Reads
  listRoomReads: (roomId) => get(`/rooms/${roomId}/reads`),

  // Room key redistribution
  uploadRoomKeys: (roomId, keys) => post(`/rooms/${roomId}/keys`, keys),

  // Cache (вызывается из Chat.svelte)
  cacheRead: async (roomId, userId, lastRead) => {
    const { putRead } = await import('./cache.js');
    return putRead(roomId, userId, lastRead);
  },
  getCachedReads: async (roomId) => {
    const { getReads } = await import('./cache.js');
    return getReads(roomId);
  },
  // iOS (Tauri): читаем APNs-токен (push.m записал в файл) через Rust invoke и
  // POSTим на /devices. В обычном web — no-op (нет __TAURI__).
  publishApnsToken: async () => {
    const t = globalThis.__TAURI__;
    if (!t?.core?.invoke) return false;
    let token;
    try { token = await t.core.invoke('read_apns_token'); } catch { return false; }
    if (!token) return false;
    // Dedup по (did, token): did из JWT. Смена device (ре-логин → новый device
    // row на сервере без токена) или смена apns-токена → шлем заново. Dedup
    // только по значению токена терял пуши после ре-логина.
    let did = '';
    try {
      const payload = getToken().split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      did = JSON.parse(atob(payload)).did || '';
    } catch {}
    const sentKey = `${did}:${token}`;
    if (localStorage.getItem('apns-token-sent') === sentKey) return true; // дубль — не шлём
    await post('/devices', { name: 'iphone', platform: 'ios', token });
    localStorage.setItem('apns-token-sent', sentKey);
    return true;
  },
  setRoomSeq: async (roomId, seq) => {
    const { setRoomSeq } = await import('./cache.js');
    return setRoomSeq(roomId, seq);
  },
  getRoomSeq: async (roomId) => {
    const { getRoomSeq } = await import('./cache.js');
    return getRoomSeq(roomId);
  },

  redistributeRoomKey: async (roomId) => {
    // Wrap room key for ALL room members (users + bots)
    const rkEntry = _roomKeys.get(roomId);
    if (!rkEntry?.raw || !_identityPriv) return;
    try {
      const [members, users] = await Promise.all([
        api.listRoomMembers(roomId),
        api.listUsers(),
      ]);
      const { unwrapRoomKey, deriveKEK, generateIdentity } = await import('./crypto.js');
      // Export room key as raw bytes
      const roomKeyRaw = rkEntry.raw;
      const { loadOrCreateIdentity } = await import('./identity.js');
      const id = await loadOrCreateIdentity();
      const priv = id.priv;
      const pub = id.pub;

      const keys = [];
      for (const m of members) {
        const u = users.find(x => x.id === m.user_id);
        if (!u || u.id === _userId) continue; // skip self
        // Get recipient's pub_key (identity backup for users, devices for bots)
        try {
          let resp = await get(`/users/${u.id}/identity-pub`);
          let recipientPubB64 = resp?.pub_key;
          if (!recipientPubB64) {
            // Fallback: try devices (bots publish pub_key here)
            const devs = await get(`/users/${u.id}/devices`);
            if (devs?.length) {
              for (const d of devs) {
                if (d.pub_key && d.pub_key.length === 44) { recipientPubB64 = d.pub_key; break; }
              }
            }
          }
          if (!recipientPubB64) continue;
          const recipientPub = new Uint8Array(atob(resp.pub_key).split('').map(c => c.charCodeAt(0)));
          if (recipientPub.length !== 32) continue;
          // Wrap room key for this recipient
          const kek = deriveKEK(priv, recipientPub, roomId);
          const nonce = crypto.getRandomValues(new Uint8Array(12));
          const { gcm } = await import('@noble/ciphers/aes.js');
          const wrapped = gcm(kek, nonce).encrypt(roomKeyRaw);
          keys.push({
            user_id: u.id,
            wrapped: btoa(String.fromCharCode(...wrapped)),
            nonce: btoa(String.fromCharCode(...nonce)),
            sender_pub: btoa(String.fromCharCode(...pub)),
          });
        } catch (e) { /* skip users without identity backup */ }
      }
      if (keys.length > 0) {
        await post(`/rooms/${roomId}/keys`, keys);
        console.log('redistributed keys to', keys.length, 'members');
        window.dispatchEvent(new CustomEvent('sschat:roomkey_ready', { detail: { roomId } }));
      }
    } catch (e) { console.error('redistributeRoomKey failed:', e.message); }
  },

  // E2E helpers (используются компонентами)
  decryptIncoming: async (msg) => {
    const rkEntry = _roomKeys.get(msg.room_id) || await _ensureRoomKey(msg.room_id);
    const rk = rkEntry?.raw || rkEntry?.key || rkEntry;
    if (!rk) return msg.body?.startsWith('{') ? '•••' : (msg.body || '');
    const { decryptBody } = await import('./crypto.js');
    return decryptBody(msg.body, rk) || '•••';
  },
};
