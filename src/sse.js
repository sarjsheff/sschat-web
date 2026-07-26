// sse.js — fetch-based SSE клиент с exponential backoff и сбросом при успехе.
// Подписывается на /events, диспатчит кастомные события на window.

export function connectSSE(token) {
  if (!token) return () => {};

  const fallback = import.meta.env?.VITE_API_BASE || '';   // см. .env.example
  const base = (() => { try { return localStorage.getItem('sschat-base-url') || fallback; } catch { return fallback; } })();
  const url = base + '/events';
  let aborted = false;
  let reconnectTimer = null;
  let backoff = 1000;
  let readTimer = null;
  let reader = null;
  let connected = false;

  const resetBackoff = () => { backoff = 1000; };
  const clearReadTimer = () => { if (readTimer) { clearTimeout(readTimer); readTimer = null; } };

  async function connect() {
    if (aborted) return;
    clearReadTimer();
    if (reader) { try { reader.cancel().catch(() => {}); } catch {} reader = null; }

    try {
      const resp = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'text/event-stream' },
      });
      if (!resp.ok) {
        console.error('SSE: HTTP', resp.status);
        scheduleReconnect();
        return;
      }

      // Успешное подключение — сбрасываем backoff
      if (!connected) { connected = true; }
      resetBackoff();

      reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let eventName = '';

      const resetReadTimer = () => {
        clearReadTimer();
        readTimer = setTimeout(() => {
          console.warn('SSE: read timeout — reconnecting');
          if (reader) { reader.cancel('timeout').catch(() => {}); reader = null; }
        }, 45000);
      };
      resetReadTimer();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        resetReadTimer();
        buf += decoder.decode(value, { stream: true });

        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trimEnd();
          buf = buf.slice(idx + 1);

          if (line === '') { eventName = ''; continue; }
          if (line.startsWith(':')) continue;

          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            const dataStr = line.slice(5).trim();
            const name = eventName || 'message';
            try {
              const payload = JSON.parse(dataStr);
              window.dispatchEvent(new CustomEvent(`sse:${name}`, { detail: payload }));
            } catch {
              window.dispatchEvent(new CustomEvent(`sse:${name}`, { detail: dataStr }));
            }
          }
        }
      }
    } catch (e) {
      if (!aborted) console.error('SSE error:', e.message || e, 'reconnect in', backoff, 'ms');
    } finally {
      clearReadTimer();
      reader = null;
    }

    scheduleReconnect();
  }

  function scheduleReconnect() {
    if (aborted) return;
    reconnectTimer = setTimeout(() => {
      backoff = Math.min(backoff * 2, 30000);
      connect();
    }, backoff);
  }

  connect();

  return () => {
    aborted = true;
    clearReadTimer();
    if (reader) { try { reader.cancel().catch(() => {}); } catch {} }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    connected = false;
  };
}
