// cache.js — офлайн-кеш в IndexedDB через idb-keyval (подход telegram-tt).
// Хранилища: sschat-msgs (сообщения), sschat-users (имена), sschat-rooms (список).
// Расшифрованные вложения chat-view кладёт отдельно, в sschat-attachments.
import { get, set, del, keys, createStore } from 'idb-keyval';

const msgStore = createStore('sschat-msgs', 'messages');
const userStore = createStore('sschat-users', 'users');   // id → {display_name, username}
const roomsStore = createStore('sschat-rooms', 'rooms');  // 'list' → [roomSummary]

// --- Пользователи (имена участников переживают перезаход) ---
export async function getCachedUser(id) { return get(id, userStore); }
export async function putCachedUser(u) {
  if (u && u.id) await set(u.id, { id: u.id, username: u.username, display_name: u.display_name, is_bot: u.is_bot }, userStore);
}

// --- Список комнат ---
// Пишется на каждый refresh; чтение (мгновенная отрисовка сайдбара до ответа
// сервера) пока не подключено — sidebar рисуется после api.listRooms().
export async function getCachedRooms() { return (await get('list', roomsStore)) || null; }
export async function setCachedRooms(rooms) { await set('list', rooms, roomsStore); }

// --- Сообщения ---
// Ключ `msg:<roomId>:<ulid>`. ULID сортируется лексикографически как хронология,
// поэтому «последние N» и «то, что до id» получаются сортировкой ключей.

async function readByIds(roomId, ids) {
  const msgs = [];
  for (const id of ids) {
    const m = await get(`msg:${roomId}:${id}`, msgStore);
    if (m) msgs.push(m);
  }
  return msgs;
}

/** Последние limit id комнаты (по возрастанию), с фильтром по id. */
async function idsFor(roomId, keep, limit) {
  const prefix = `msg:${roomId}:`;
  const all = await keys(msgStore);
  return all
    .filter(k => k.startsWith(prefix) && keep(k.slice(prefix.length)))
    .map(k => k.slice(prefix.length))
    .sort().reverse().slice(0, limit)
    .reverse();
}

/** Последние limit сообщений комнаты, oldest-first. */
export async function getMessages(roomId, limit = 50) {
  return readByIds(roomId, await idsFor(roomId, () => true, limit));
}

/** Сообщения старше beforeId, oldest-first. */
export async function getMessagesBefore(roomId, beforeId, limit = 50) {
  return readByIds(roomId, await idsFor(roomId, id => id < beforeId, limit));
}

export async function putMessage(roomId, msg, plaintext) {
  await set(`msg:${roomId}:${msg.id}`, { ...msg, _plaintext: plaintext }, msgStore);
}

export async function putMessages(roomId, items) {
  for (const { msg, plaintext } of items) await putMessage(roomId, msg, plaintext);
}

export async function removeMessage(roomId, msgId) {
  await del(`msg:${roomId}:${msgId}`, msgStore);
}

// --- Полный сброс (кнопка в настройках) ---
// sschat-meta и sschat-reads остались от прежней схемы кеша: код их больше не
// пишет, но у старых установок базы есть — сносим вместе с остальными.
const ALL_DBS = ['sschat-msgs', 'sschat-meta', 'sschat-reads', 'sschat-users', 'sschat-rooms', 'sschat-attachments'];

export async function clearAllCache() {
  for (const name of ALL_DBS) {
    try {
      await new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => { console.warn('база занята:', name); resolve(); };
      });
    } catch (e) { console.error('clearAllCache', name, e); }
  }
}
