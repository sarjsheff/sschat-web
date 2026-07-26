// cache.js — IndexedDB кеш через idb-keyval (как telegram-tt)
// Хранилища: sschat-msgs, sschat-meta, sschat-reads, sschat-users, sschat-rooms
import { get, set, del, keys, createStore } from 'idb-keyval';

const msgStore = createStore('sschat-msgs', 'messages');
const metaStore = createStore('sschat-meta', 'meta');
const readStore = createStore('sschat-reads', 'reads');
const userStore = createStore('sschat-users', 'users'); // id → {display_name, username}
const roomsStore = createStore('sschat-rooms', 'rooms'); // 'list' → [roomSummary] (имена/unread/last_message)

// --- Юзеры (имена участников) ---
export async function getCachedUser(id) { return get(id, userStore); }
export async function putCachedUser(u) { if (u && u.id) await set(u.id, { id: u.id, username: u.username, display_name: u.display_name, is_bot: u.is_bot }, userStore); }
export async function putCachedUsers(list) { for (const u of list || []) await putCachedUser(u); }

// --- Список комнат (мгновенный рендер сайдбара до сети) ---
export async function getCachedRooms() { return (await get('list', roomsStore)) || null; }
export async function setCachedRooms(rooms) { await set('list', rooms, roomsStore); }

// --- Messages ---

export async function getMessages(roomId, limit = 50) {
  const prefix = `msg:${roomId}:`;
  const all = await keys(msgStore);
  const ids = all.filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length)).sort().reverse().slice(0, limit);
  const msgs = [];
  for (const id of ids.reverse()) {
    const m = await get(`msg:${roomId}:${id}`, msgStore);
    if (m) msgs.push(m);
  }
  return msgs;
}

export async function getMessagesBefore(roomId, beforeId, limit = 50) {
  const prefix = `msg:${roomId}:`;
  const all = await keys(msgStore);
  const ids = all.filter(k => k.startsWith(prefix) && k.slice(prefix.length) < beforeId)
    .map(k => k.slice(prefix.length)).sort().reverse().slice(0, limit);
  const msgs = [];
  for (const id of ids.reverse()) {
    const m = await get(`msg:${roomId}:${id}`, msgStore);
    if (m) msgs.push(m);
  }
  return msgs;
}

export async function putMessage(roomId, msg, plaintext) {
  const key = `msg:${roomId}:${msg.id}`;
  await set(key, { ...msg, _plaintext: plaintext }, msgStore);
}

export async function putMessages(roomId, items) {
  for (const { msg, plaintext } of items) {
    await set(`msg:${roomId}:${msg.id}`, { ...msg, _plaintext: plaintext }, msgStore);
  }
}

export async function removeMessage(roomId, msgId) {
  await del(`msg:${roomId}:${msgId}`, msgStore);
}

export async function lastMsgId(roomId) {
  return await get(`meta:${roomId}:lastId`, metaStore);
}

// --- Room Meta ---

export async function getRoomMeta(roomId) {
  const m = await get(`meta:${roomId}`, metaStore);
  return m || { latest_cached_id: null, oldest_cached_id: null, has_more_older: true, room_seq: 0 };
}

export async function setRoomMeta(roomId, meta) {
  await set(`meta:${roomId}`, meta, metaStore);
}

export async function getRoomSeq(roomId) {
  const m = await getRoomMeta(roomId);
  return m.room_seq || 0;
}

export async function setRoomSeq(roomId, seq) {
  const m = await getRoomMeta(roomId);
  m.room_seq = Math.max(m.room_seq || 0, seq);
  await setRoomMeta(roomId, m);
}

export async function setLastMsgId(roomId, id) {
  await set(`meta:${roomId}:lastId`, id, metaStore);
}

export async function setHasMoreOlder(roomId, value) {
  const m = await getRoomMeta(roomId);
  m.has_more_older = value;
  await setRoomMeta(roomId, m);
}

export async function updateMetaAfterBatch(roomId, msgs) {
  if (msgs.length === 0) return;
  const ids = msgs.map(m => m.id).sort();
  const m = await getRoomMeta(roomId);
  if (!m.oldest_cached_id || ids[0] < m.oldest_cached_id) m.oldest_cached_id = ids[0];
  if (!m.latest_cached_id || ids[ids.length - 1] > m.latest_cached_id) m.latest_cached_id = ids[ids.length - 1];
  await setRoomMeta(roomId, m);
}

// --- Reads ---

export async function getReads(roomId) {
  const prefix = `read:${roomId}:`;
  const all = await keys(readStore);
  const pairs = [];
  for (const k of all) {
    if (k.startsWith(prefix)) {
      const userId = k.slice(prefix.length);
      pairs.push({ user_id: userId, last_read: await get(k, readStore) });
    }
  }
  return pairs;
}

export async function putRead(roomId, userId, lastRead) {
  await set(`read:${roomId}:${userId}`, lastRead, readStore);
}

export async function putReads(roomId, items) {
  for (const { user_id, last_read } of items) {
    await set(`read:${roomId}:${user_id}`, last_read, readStore);
  }
}

// --- Admin: полный сброс кеша ---
export async function clearAllCache() {
  // Удаляем все IndexedDB хранилища sschat
  const dbs = ['sschat-msgs', 'sschat-meta', 'sschat-reads', 'sschat-users', 'sschat-rooms', 'sschat-attachments'];
  for (const name of dbs) {
    try {
      await new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => { console.warn('db blocked:', name); resolve(); };
      });
    } catch (e) { console.error('clearCache', name, e); }
  }
}
