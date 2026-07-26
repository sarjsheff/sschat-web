// Тщательный тест скроллинга chat-view.js. Инвариант «не прыгает»: сообщения,
// видимые на экране, при сдвиге окна (older/newer) остаются на том же месте.
// Моделирует реальный DOM: контейнер с scrollTop, строки фикс. высоты,
// getBoundingClientRect, querySelector. Позиции scrollTop - реалистичные для
// каждого режима (older срабатывает у верха, newer - у низа).
// Запуск: node test/chat-view-scroll-anchor-test.mjs
//
// Ловит регрессию web-0.2.0: anchor-restore потерял базовый scrollTop
// (scrollTo(0, newTop - aTop) вместо scrollTop + newTop - aTop) → прыжок на -S.

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

const H = 20;         // высота строки, px
const CLIENT = 300;   // высота viewport, px
function mkId(n) { return '01' + String(n).padStart(24, '0'); }
function mkMsgs(n) { return Array.from({ length: n }, (_, i) => ({ id: mkId(i), body: 'm' + i })); }

function makeScroll() {
  return {
    scrollTop: 0,
    renderedIds: [],
    clientHeight: CLIENT,
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
    querySelector(sel) {
      const m = /\[data-msgid="(.+?)"\]/.exec(sel);
      if (!m || this.renderedIds.indexOf(m[1]) < 0) return null;
      const id = m[1], self = this;
      return { getBoundingClientRect: () => ({ top: self._rectTop(id) }) };
    },
  };
}

function makeCV(msgs) {
  const cv = Object.create(ChatView.prototype);
  cv.messages = msgs.slice();
  cv.viewIds = [];
  const scrollEl = makeScroll();
  cv.shadowRoot = { querySelector: (sel) => (sel === '#scroll' ? scrollEl : null) };
  cv._scrollEl = scrollEl;
  return cv;
}

// id, реально видимые на экране (rectTop пересекает [0, clientHeight))
function visible(scrollEl) {
  return scrollEl.renderedIds.filter(id => {
    const t = scrollEl._rectTop(id);
    return t > -H && t < scrollEl.clientHeight;
  });
}
// снимок экранных позиций всех отрисованных строк
function snapshot(scrollEl) {
  const m = {};
  for (const id of scrollEl.renderedIds) m[id] = scrollEl._rectTop(id);
  return m;
}

// Один сдвиг окна, повторяющий поток _loadOlder/_shiftNewer с восстановлением якоря.
// Возвращает макс. смещение видимых-до строк, оставшихся отрисованными после.
function shiftAndMeasureJump(cv, mode, S) {
  const scrollEl = cv._scrollEl;
  scrollEl.renderedIds = cv.viewIds.slice();
  scrollEl.scrollTop = S;

  const beforeVisible = visible(scrollEl);
  const beforePos = snapshot(scrollEl);

  cv._updateViewport(mode);
  const a = cv._anchor();              // якорь по старому DOM
  scrollEl.renderedIds = cv.viewIds.slice(); // перерисовка нового окна
  if (a) {
    const el = scrollEl.querySelector(`[data-msgid="${a.id}"]`);
    const newTop = el.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top;
    scrollEl.scrollTo(0, cv._anchorTarget(scrollEl.scrollTop, newTop, a.top));
  }
  const afterPos = snapshot(scrollEl);

  // насколько сместились строки, что были видимы ДО и остались в DOM
  let maxJump = 0, checked = 0;
  for (const id of beforeVisible) {
    if (afterPos[id] === undefined) continue;
    checked++;
    maxJump = Math.max(maxJump, Math.abs(afterPos[id] - beforePos[id]));
  }
  return { maxJump, checked, overlapVisible: visible(scrollEl).filter(id => beforeVisible.includes(id)).length };
}

// === 1. older (вверх): видимые сообщения не прыгают, у верха ===
console.log('# older — видимая зона не сдвигается (scrollTop мал, как при триггере у верха)');
for (const S of [0, 20, 60, 120, 200]) {
  const cv = makeCV(mkMsgs(400));
  cv._updateViewport('bottom');
  cv._updateViewport('older');
  cv._updateViewport('older'); // ушли в историю
  const r = shiftAndMeasureJump(cv, 'older', S);
  check(`older @${S}: видимые не сместились (${r.checked} строк)`, r.checked > 0 && r.maxJump < 0.5, `jump=${r.maxJump}`);
}

// === 2. newer (вниз): scrollTop велик (триггер у низа окна) ===
console.log('# newer — видимая зона не сдвигается (scrollTop велик, как при триггере у низа)');
for (const S of [1000, 1100, 1250, 1300]) {
  const cv = makeCV(mkMsgs(400));
  cv._updateViewport('bottom');
  for (let i = 0; i < 5; i++) cv._updateViewport('older'); // глубоко в историю (окно 80)
  const r = shiftAndMeasureJump(cv, 'newer', S);
  check(`newer @${S}: видимые не сместились (${r.checked} строк)`, r.checked > 0 && r.maxJump < 0.5, `jump=${r.maxJump}`);
}

// === 3. непрерывность: серия older не рвёт и не прыгает ===
console.log('# непрерывность — серия older плавная и без разрывов');
{
  const cv = makeCV(mkMsgs(400));
  cv._updateViewport('bottom');
  const all = cv.messages.map(m => m.id);
  let smooth = true, contiguous = true, overlaps = true;
  for (let i = 0; i < 8; i++) {
    const r = shiftAndMeasureJump(cv, 'older', 60);
    if (!(r.checked > 0 && r.maxJump < 0.5)) smooth = false;
    if (r.overlapVisible === 0) overlaps = false;
    const s = all.indexOf(cv.viewIds[0]);
    if (cv.viewIds.join() !== all.slice(s, s + cv.viewIds.length).join()) contiguous = false;
  }
  check('серия older: без прыжков на каждом шаге', smooth);
  check('серия older: видимая зона всегда перекрывается (непрерывно)', overlaps);
  check('серия older: окно всегда непрерывный срез', contiguous);
}

// === 4. туда-обратно: older затем newer возвращает к тем же сообщениям ===
console.log('# older→newer — согласованность окна');
{
  const cv = makeCV(mkMsgs(400));
  cv._updateViewport('bottom');
  for (let i = 0; i < 4; i++) cv._updateViewport('older');
  const mid = cv.viewIds.slice();
  cv._updateViewport('newer');
  cv._updateViewport('older'); // вернулись
  check('older→newer→older: окно вернулось', cv.viewIds.join() === mid.join());
}

// === 5. bottom у нижнего края ===
console.log('# bottom');
{
  const cv = makeCV(mkMsgs(400));
  cv._updateViewport('bottom');
  const all = cv.messages.map(m => m.id);
  check('_atNewestEdge после bottom', cv._atNewestEdge() === true);
  check('bottom: последний в окне = глобально последний', cv.viewIds[cv.viewIds.length - 1] === all[all.length - 1]);
}

// === 6. малая история (< окна): без сдвигов и прыжков ===
console.log('# короткая история');
{
  const cv = makeCV(mkMsgs(12));
  cv._updateViewport('bottom');
  const r = shiftAndMeasureJump(cv, 'older', 0);
  check('12 сообщений: older не двигает (всё влезает)', r.maxJump < 0.5 || r.checked === 0);
  check('12 сообщений: у нижнего края', cv._atNewestEdge() === true);
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: ${passed} ok, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
