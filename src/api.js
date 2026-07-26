// api.js — HTTP-клиент sschat-сервера.
//
// Здесь только то, что вызывается из компонентов. chat-view и room-info ходят
// в сеть своим fetch (самодостаточность: chat-view импортируется терминальными
// тестами со стабами DOM, статический импорт этого модуля потянул бы idb-keyval).
import { BUILD_INFO } from './build-info.js';
import { getBase, setBaseURL } from './config.js';

export function getToken() {
  try { return localStorage.getItem('sschat-token'); } catch { return null; }
}

export function setToken(t) {
  try {
    if (t === null || t === undefined) localStorage.removeItem('sschat-token');
    else localStorage.setItem('sschat-token', t);
  } catch {}
}

/** Payload JWT текущего токена (base64url) или null. */
function tokenPayload() {
  try {
    const part = getToken().split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part.padEnd(part.length + (4 - part.length % 4) % 4, '=')));
  } catch { return null; }
}

async function request(method, path, body) {
  const headers = { 'Authorization': `Bearer ${getToken()}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const resp = await fetch(getBase() + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await resp.text();
  if (!resp.ok) {
    let msg = text;
    try { msg = JSON.parse(text).error || text; } catch {}
    throw new Error(`${method} ${path} → ${resp.status}: ${msg}`);
  }
  return text ? JSON.parse(text) : null;
}

const get = (path) => request('GET', path);
const post = (path, body) => request('POST', path, body);
const patch = (path, body) => request('PATCH', path, body);
const del = (path) => request('DELETE', path);

// --- E2E: identity и кеш комнатных ключей (общий на все компоненты) ---
let _identityPriv = null;
let _userId = null;
const _roomKeys = new Map();
const _roomKeyNotFound = new Set();

export function setIdentity(priv, uid) { _identityPriv = priv; _userId = uid; }

/** Комнатный ключ из кеша, иначе распаковать свою копию с сервера. */
async function ensureKey(roomId) {
  if (_roomKeys.has(roomId)) return _roomKeys.get(roomId);
  if (_roomKeyNotFound.has(roomId) || !_identityPriv) return null;
  try {
    const { ensureRoomKey } = await import('./room-key.js');
    const key = await ensureRoomKey(roomId, _identityPriv);
    if (key) { _roomKeys.set(roomId, key); return key; }
    _roomKeyNotFound.add(roomId);
  } catch {}
  return null;
}

/** Сгенерировать ключ новой комнаты, завернуть себе и раздать участникам. */
async function createRoomKey(roomId) {
  if (!_identityPriv || !_userId) { console.error('createRoomKey: нет identity/userId — ключ не создан'); return; }
  const roomKey = crypto.getRandomValues(new Uint8Array(32));
  const { deriveKEK } = await import('./crypto.js');
  const { loadOrCreateIdentity } = await import('./identity.js');
  const id = await loadOrCreateIdentity();

  const kek = deriveKEK(id.priv, id.pub, roomId);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const { gcm } = await import('@noble/ciphers/aes.js');
  const wrapped = gcm(kek, nonce).encrypt(roomKey);

  await post(`/rooms/${roomId}/keys`, [{
    user_id: _userId,
    wrapped: b64(wrapped),
    nonce: b64(nonce),
    sender_pub: b64(id.pub),
  }]);

  const cryptoKey = await crypto.subtle.importKey('raw', roomKey, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  _roomKeys.set(roomId, { key: cryptoKey, raw: roomKey });
  api.redistributeRoomKey(roomId).catch(() => {});
}

function b64(bytes) { return btoa(String.fromCharCode(...bytes)); }
function fromB64(s) { return new Uint8Array([...atob(s)].map(c => c.charCodeAt(0))); }

/** Публичный ключ получателя: identity-backup, иначе pub_key любого его устройства. */
async function recipientPubKey(userId) {
  const resp = await get(`/users/${userId}/identity-pub`).catch(() => null);
  if (resp?.pub_key) return resp.pub_key;
  const devices = await get(`/users/${userId}/devices`).catch(() => null);
  for (const d of devices || []) if (d.pub_key?.length === 44) return d.pub_key;
  return null;
}

export const api = {
  setBaseURL,

  // --- Состояние сессии ---
  getState: async () => {
    if (!getToken()) return { baseURL: getBase(), authenticated: false, me: null };
    try {
      return { baseURL: getBase(), authenticated: true, me: await get('/me') };
    } catch {
      setToken(null);
      return { baseURL: getBase(), authenticated: false, me: null };
    }
  },
  getClientVersion: () => BUILD_INFO,
  /** ID устройства текущей сессии (claim did в JWT) — чтобы отметить его в списке. */
  currentDeviceID: () => tokenPayload()?.did || null,

  // --- Аутентификация ---
  getServerSettings: () => get('/settings'),
  login: (username, password) => post('/login', { username, password }),
  submitCode: async (challengeId, code) => {
    const cid = (typeof challengeId === 'string' ? challengeId : challengeId?.challenge_id) || challengeId;
    const resp = await post('/auth/code', { challenge_id: cid, code, device_name: 'sschat-web', platform: 'web' });
    if (resp.token) setToken(resp.token);
    return resp;
  },
  logout: () => setToken(null),
  me: () => get('/me'),
  changePassword: (oldPassword, newPassword) => post('/me/password', { old_password: oldPassword, new_password: newPassword }),

  // --- Комнаты ---
  listRooms: () => get('/rooms?limit=200'),
  createRoom: async (name) => {
    const room = await post('/rooms', { name });
    createRoomKey(room.id).catch(e => console.error('createRoomKey:', e));
    return room;
  },
  getRoomAvatarUrl: (roomId) => `${getBase()}/rooms/${roomId}/avatar`,

  // --- Пользователи ---
  listUsers: () => get('/users'),
  listRoomMembers: (roomId) => get(`/rooms/${roomId}/members`),

  // --- Устройства ---
  registerDevice: (pubKey) => post('/devices', { pub_key: pubKey, platform: 'web', name: 'sschat-web' }),
  listMyDevices: () => get('/devices'),
  deleteDevice: (id) => del(`/devices/${id}`),

  // --- Боты ---
  listBots: () => get('/bots'),
  createBot: (username, displayName) => post('/bots', { username, display_name: displayName }),
  deleteBot: (id) => del(`/bots/${id}`),
  regenerateBotToken: (id) => post(`/bots/${id}/regenerate-token`),

  // --- Комнатные ключи (E2E) ---
  getMyRoomKey: (roomId) => get(`/rooms/${roomId}/keys/me`),

  /** Завернуть ключ комнаты для всех её участников (после добавления устройства/участника). */
  redistributeRoomKey: async (roomId) => {
    const rkEntry = _roomKeys.get(roomId) || await ensureKey(roomId);
    if (!rkEntry?.raw || !_identityPriv) return;
    try {
      const [members, users] = await Promise.all([api.listRoomMembers(roomId), api.listUsers()]);
      const { deriveKEK } = await import('./crypto.js');
      const { gcm } = await import('@noble/ciphers/aes.js');
      const { loadOrCreateIdentity } = await import('./identity.js');
      const id = await loadOrCreateIdentity();

      const keys = [];
      for (const m of members) {
        const u = users.find(x => x.id === m.user_id);
        if (!u || u.id === _userId) continue;
        try {
          const pubB64 = await recipientPubKey(u.id);
          if (!pubB64) continue;                       // нет опубликованного ключа — пропускаем
          const recipientPub = fromB64(pubB64);
          if (recipientPub.length !== 32) continue;
          const nonce = crypto.getRandomValues(new Uint8Array(12));
          const wrapped = gcm(deriveKEK(id.priv, recipientPub, roomId), nonce).encrypt(rkEntry.raw);
          keys.push({ user_id: u.id, wrapped: b64(wrapped), nonce: b64(nonce), sender_pub: b64(id.pub) });
        } catch {}
      }
      if (keys.length) await post(`/rooms/${roomId}/keys`, keys);
    } catch (e) { console.error('redistributeRoomKey:', e.message); }
  },

  // --- iOS push ---
  // push.m кладёт APNs-токен в файл, Rust отдаёт его через invoke. В вебе — no-op.
  // Dedup по паре (device, token): после ре-логина device другой и токен нужно
  // переслать, хотя его значение не изменилось.
  publishApnsToken: async () => {
    const t = globalThis.__TAURI__;
    if (!t?.core?.invoke) return false;
    let token;
    try { token = await t.core.invoke('read_apns_token'); } catch { return false; }
    if (!token) return false;
    const sentKey = `${tokenPayload()?.did || ''}:${token}`;
    if (localStorage.getItem('apns-token-sent') === sentKey) return true;
    await post('/devices', { name: 'iphone', platform: 'ios', token });
    localStorage.setItem('apns-token-sent', sentKey);
    return true;
  },
};
