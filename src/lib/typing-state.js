// Глобальное typing-состояние per-room. Живёт ВНЕ компонентов, переживает
// выход/вход в комнату (Telegram-style). Заполняется в sschat-app (слушает sse:typing).
const TTL = 6000;

const byRoom = {};

export function recordTyping(roomId, userId) {
  if (!roomId || !userId) return;
  if (!byRoom[roomId]) byRoom[roomId] = {};
  byRoom[roomId][userId] = Date.now();
}

export function typersFor(roomId, excludeUserId) {
  const room = byRoom[roomId];
  if (!room) return [];
  const now = Date.now();
  return Object.entries(room)
    .filter(([uid, t]) => uid !== excludeUserId && now - t < TTL)
    .map(([uid]) => uid);
}

let cleanupTimer = null;
export function startTypingCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const roomId of Object.keys(byRoom)) {
      const room = byRoom[roomId];
      let changed = false;
      for (const [uid, t] of Object.entries(room)) {
        if (now - t >= TTL) { delete room[uid]; changed = true; }
      }
    }
  }, 1000);
}
