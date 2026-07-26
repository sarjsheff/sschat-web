// Тест скролла в модели WKWebView (мобила — приоритетная платформа).
// Воспроизводит документированную граблю: в Shadow DOM атрибутный
// scrollEl.querySelector('[data-msgid=...]') возвращает null, хотя строки
// реально в DOM и достижимы обходом children + dataset.msgid.
//
// С этим стабом anchor-restore на querySelector НЕ находит якорь → лента
// прыгает при подгрузке (симптом «скочет непойми куда»). Ловит регрессию
// web-0.2.x, где ручной обход заменили на querySelector.
// Запуск: node test/chat-view-scroll-wkwebview-test.mjs

globalThis.HTMLElement = class {};
globalThis.customElements = { define: (n, c) => { globalThis.__ChatView = c; } };
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };

await import('../src/chat-view.js');
const ChatView = globalThis.__ChatView;

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? '  — ' + extra : ''}`); }
}

const H = 20, CLIENT = 300;
function mkId(n) { return '01' + String(n).padStart(24, '0'); }
function mkMsgs(n) { return Array.from({ length: n }, (_, i) => ({ id: mkId(i), body: 'm' + i })); }

// Модель WKWebView: querySelector('[data-msgid]') ВСЕГДА null, но строки
// доступны через children (list → rows), у каждой dataset.msgid + rect.
function makeWkScroll() {
  const scroll = {
    scrollTop: 0,
    renderedIds: [],
    clientHeight: CLIENT,
    offsetHeight: 0, // форс-layout читает это
    get scrollHeight() { return this.renderedIds.length * H; },
    getBoundingClientRect() { return { top: 0 }; },
    scrollTo(x, y) {
      const max = Math.max(0, this.scrollHeight - this.clientHeight);
      this.scrollTop = Math.max(0, Math.min(y, max));
    },
    _rectTop(id) {
      const i = this.renderedIds.indexOf(id);
      return i < 0 ? null : i * H - this.scrollTop;
    },
    // WKWebView-гpабля: атрибутный селектор в Shadow DOM не находит
    querySelector() { return null; },
  };
  // #scroll → #list → rows. children отражают renderedIds.
  Object.defineProperty(scroll, 'children', {
    get() {
      const rows = scroll.renderedIds.map(id => ({
        dataset: { msgid: id },
        children: [],
        getBoundingClientRect: () => ({ top: scroll._rectTop(id) }),
      }));
      return [{ dataset: {}, children: rows, getBoundingClientRect: () => ({ top: 0 }) }];
    },
  });
  return scroll;
}

function makeCV(msgs) {
  const cv = Object.create(ChatView.prototype);
  cv.messages = msgs.slice();
  cv.viewIds = [];
  const scrollEl = makeWkScroll();
  cv.shadowRoot = { querySelector: (sel) => (sel === '#scroll' ? scrollEl : null) };
  cv._scrollEl = scrollEl;
  return cv;
}

function visible(scrollEl) {
  return scrollEl.renderedIds.filter(id => {
    const t = scrollEl._rectTop(id);
    return t > -H && t < scrollEl.clientHeight;
  });
}
function snapshot(scrollEl) {
  const m = {};
  for (const id of scrollEl.renderedIds) m[id] = scrollEl._rectTop(id);
  return m;
}

// Повторяет поток _loadOlder: capture anchor (по СТАРОМУ DOM) → рендер нового
// окна → restore через _findMsgEl. В WKWebView-модели querySelector=null,
// значит всё держится на ручном обходе.
function shiftAndMeasureJump(cv, mode, S) {
  const scrollEl = cv._scrollEl;
  scrollEl.renderedIds = cv.viewIds.slice();
  scrollEl.scrollTop = S;

  const beforeVisible = visible(scrollEl);
  const beforePos = snapshot(scrollEl);

  cv._updateViewport(mode);
  const a = cv._anchor();                       // ← использует _findMsgEl
  scrollEl.renderedIds = cv.viewIds.slice();    // перерисовка нового окна
  if (a) {
    const el = cv._findMsgEl(scrollEl, a.id);   // ← ручной обход в WKWebView
    if (el) {
      const newTop = el.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top;
      scrollEl.scrollTo(0, cv._anchorTarget(scrollEl.scrollTop, newTop, a.top));
    }
  }
  const afterPos = snapshot(scrollEl);

  let maxJump = 0, checked = 0;
  for (const id of beforeVisible) {
    if (afterPos[id] === undefined) continue;
    checked++;
    maxJump = Math.max(maxJump, Math.abs(afterPos[id] - beforePos[id]));
  }
  return { maxJump, checked, anchorFound: !!a };
}

// === 1. _findMsgEl находит строку даже когда querySelector=null (WKWebView) ===
console.log('# _findMsgEl: ручной обход при querySelector=null');
{
  const cv = makeCV(mkMsgs(400));
  cv._updateViewport('bottom');
  const scrollEl = cv._scrollEl;
  scrollEl.renderedIds = cv.viewIds.slice();
  check('querySelector в модели даёт null (WKWebView)', scrollEl.querySelector('[data-msgid]') === null);
  const el = cv._findMsgEl(scrollEl, cv.viewIds[10]);
  check('_findMsgEl нашёл строку обходом children', !!el && typeof el.getBoundingClientRect === 'function');
  check('_findMsgEl null для отсутствующего id', cv._findMsgEl(scrollEl, 'нет-такого') == null);
}

// === 2. _anchor не null в WKWebView ===
console.log('# _anchor держится в WKWebView (не null)');
{
  const cv = makeCV(mkMsgs(400));
  cv._updateViewport('bottom');
  cv._updateViewport('older');
  cv._scrollEl.renderedIds = cv.viewIds.slice();
  cv._scrollEl.scrollTop = 60;
  const a = cv._anchor();
  check('_anchor вернул якорь (не null)', a && a.id, a ? '' : 'anchor=null → прыжок');
}

// === 3. older: видимые сообщения не прыгают (WKWebView) ===
console.log('# older — лента не прыгает при подгрузке (WKWebView)');
for (const S of [0, 20, 60, 120, 200]) {
  const cv = makeCV(mkMsgs(400));
  cv._updateViewport('bottom');
  cv._updateViewport('older');
  cv._updateViewport('older');
  const r = shiftAndMeasureJump(cv, 'older', S);
  check(`older @${S}: якорь найден и лента на месте (${r.checked} строк)`,
    r.anchorFound && r.checked > 0 && r.maxJump < 0.5, `jump=${r.maxJump} anchor=${r.anchorFound}`);
}

// === 4. непрерывная серия older без прыжков (WKWebView) ===
console.log('# серия older — плавно, без прыжков (WKWebView)');
{
  const cv = makeCV(mkMsgs(400));
  cv._updateViewport('bottom');
  let smooth = true;
  for (let i = 0; i < 8; i++) {
    const r = shiftAndMeasureJump(cv, 'older', 60);
    if (!(r.anchorFound && r.checked > 0 && r.maxJump < 0.5)) smooth = false;
  }
  check('серия older: каждый шаг без прыжка', smooth);
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: ${passed} ok, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
