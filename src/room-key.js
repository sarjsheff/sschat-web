// room-key.js — получение и кеширование комнатных ключей (E2E)
import { api } from './api.js';
import { unwrapRoomKey } from './crypto.js';

const roomKeys = new Map();

export async function ensureRoomKey(roomId, identityPriv) {
  if (roomKeys.has(roomId)) return roomKeys.get(roomId);
  try {
    const resp = await api.getMyRoomKey(roomId);
    if (!resp || !resp.wrapped) return null;
    const wrapped = b64(resp.wrapped), nonce = b64(resp.nonce), senderPub = b64(resp.sender_pub);
    const roomKeyRaw = unwrapRoomKey(identityPriv, wrapped, nonce, senderPub, roomId);
    const roomKey = await crypto.subtle.importKey('raw', roomKeyRaw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const entry = { key: roomKey, raw: roomKeyRaw };
    roomKeys.set(roomId, entry);
    return entry;
  } catch (e) {
    // 404 = ключ еще не создан (новая комната), 403/401 = нет доступа
    if (!e.message?.includes('404')) {
      console.error('ensureRoomKey failed for', roomId.slice(0,8), e.message);
    }
    return null;
  }
}

function b64(s) { return new Uint8Array([...atob(s)].map(c => c.charCodeAt(0))); }
