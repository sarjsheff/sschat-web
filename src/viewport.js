// viewport.js — виртуальный скролл по паттерну telegram-tt
// Два списка: allIds (все известные ID) + viewIds (рендеримый срез)
// IntersectionObserver-триггеры для подгрузки старых/новых сообщений

export const MESSAGE_LIST_SLICE = 40;
const VIEWPORT_LIMIT = MESSAGE_LIST_SLICE * 2;

/**
 * Создать viewport-менеджер для комнаты.
 * @param {function} onLoadOlder - колбэк когда нужна подгрузка старых
 * @param {function} onLoadNewer - колбэк когда нужна подгрузка новых
 */
export function createViewport(onLoadOlder, onLoadNewer) {
  let allIds = [];       // полный список ID (может быть большим)
  let viewIds = [];      // текущий рендеримый срез
  let anchorId = null;   // ID сообщения-якоря для сохранения позиции при prepend
  let anchorTop = 0;     // позиция якоря до обновления
  let isAtBottom = true; // пользователь внизу списка?
  let observers = null;
  let scrollEl = null;

  function getSlice(ids, focusId) {
    if (ids.length <= MESSAGE_LIST_SLICE) return ids;
    const idx = focusId ? ids.indexOf(focusId) : -1;
    const center = idx >= 0 ? idx : ids.length - 1;
    const half = Math.floor(MESSAGE_LIST_SLICE / 2);
    const start = Math.max(0, center - half);
    const end = Math.min(ids.length, start + MESSAGE_LIST_SLICE);
    return ids.slice(Math.max(0, end - MESSAGE_LIST_SLICE), end);
  }

  /** Заменить полный список ID (начальная загрузка).
   *  Сортируем, затем берём последние MESSAGE_LIST_SLICE элементов (новейшие). */
  function setAllIds(ids, scrollToBottom) {
    allIds = [...ids].sort();
    // Простой slice с конца — последние 40 элементов = новейшие сообщения
    if (allIds.length > MESSAGE_LIST_SLICE) {
      viewIds = allIds.slice(-MESSAGE_LIST_SLICE);
    } else {
      viewIds = allIds;
    }
    if (scrollToBottom) isAtBottom = true;
    return viewIds;
  }

  /** Сдвинуть окно viewport к новым сообщениям (постраничный скролл вниз). */
  function shiftNewer() {
    if (allIds.length <= MESSAGE_LIST_SLICE) return;
    // Центр — последний элемент в текущем viewIds (или последний в allIds)
    const focusId = viewIds.length > 0 ? viewIds[viewIds.length - 1] : allIds[allIds.length - 1];
    const idx = allIds.indexOf(focusId);
    if (idx < 0) return;
    // Сдвигаем окно на половину MESSAGE_LIST_SLICE вперёд
    const newCenter = Math.min(allIds.length - 1, idx + Math.floor(MESSAGE_LIST_SLICE / 2));
    viewIds = getSlice(allIds, allIds[newCenter]);
    return viewIds;
  }

  /** Добавить новые ID в конец (новые сообщения) */
  function appendIds(newIds) {
    const existing = new Set(allIds);
    const fresh = newIds.filter(id => !existing.has(id));
    if (fresh.length === 0) return [];
    allIds = [...allIds, ...fresh].sort();
    if (isAtBottom) {
      viewIds = getSlice(allIds, null); // сдвигаем к концу
    }
    return fresh;
  }

  /** Добавить старые ID в начало (scroll-back) */
  function prependIds(oldIds) {
    const existing = new Set(allIds);
    const fresh = oldIds.filter(id => !existing.has(id));
    if (fresh.length === 0) return [];
    // Сохраняем якорь для восстановления позиции
    if (viewIds.length > 1) anchorId = viewIds[1]; // второй сверху
    allIds = [...fresh, ...allIds].sort();
    viewIds = getSlice(allIds, anchorId || viewIds[0]);
    return fresh;
  }

  /** Сохранить якорь перед перерисовкой */
  function saveAnchor() {
    if (!scrollEl || viewIds.length < 2) return;
    // Находим второй сверху элемент в DOM
    const el = scrollEl.querySelector(`[data-msgid="${viewIds[1]}"]`);
    if (el) {
      anchorId = viewIds[1];
      anchorTop = el.getBoundingClientRect().top;
    }
  }

  /** Восстановить позицию скролла после перерисовки */
  function restoreAnchor() {
    if (!scrollEl || !anchorId) return;
    requestAnimationFrame(() => {
      const el = scrollEl.querySelector(`[data-msgid="${anchorId}"]`);
      if (el) {
        const delta = el.getBoundingClientRect().top - anchorTop;
        scrollEl.scrollTop += delta;
      }
      anchorId = null;
    });
  }

  /** Присоединить IntersectionObserver-сентинели */
  function attach(scrollElement, topSentinel, bottomSentinel) {
    scrollEl = scrollElement;
    if (observers) observers.forEach(o => o.disconnect());
    observers = [];

    if (topSentinel) {
      const obs = new IntersectionObserver((entries) => {
        const e = entries[0];
        // Fire on first intersection AND when ratio changes (scroll-back trigger)
        if (e.isIntersecting) onLoadOlder();
      }, { root: scrollElement, rootMargin: '0px 0px 200px 0px' });
      obs.observe(topSentinel);
      observers.push(obs);
    }

    if (bottomSentinel) {
      const obs = new IntersectionObserver((entries) => {
        const wasAtBottom = isAtBottom;
        isAtBottom = entries[0].isIntersecting;
        if (!wasAtBottom && isAtBottom && onLoadNewer) {
          // Юзер доскроллил до низа — триггерим loadNewer (сдвиг окна к новым)
          onLoadNewer();
        }
      }, { root: scrollElement, rootMargin: '0px 0px 200px 0px' });
      obs.observe(bottomSentinel);
      observers.push(obs);
    }
  }

  function destroy() {
    if (observers) { observers.forEach(o => o.disconnect()); observers = null; }
    scrollEl = null;
  }

  const vp = {
    get allIds() { return allIds; },
    get viewIds() { return viewIds; },
    get isAtBottom() { return isAtBottom; },
    setAllIds,
    appendIds,
    prependIds,
    shiftNewer,
    saveAnchor,
    restoreAnchor,
    attach,
    destroy,
  };
  return vp;
}
