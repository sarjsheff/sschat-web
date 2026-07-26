// Терминальный тест скролл-логики chat-view.js (виртуальное окно).
// Стабит DOM, импортит НАСТОЯЩИЙ chat-view.js, тестирует чистые методы
// (_allIdsSorted/_updateViewport/_atNewestEdge/_insertSorted) через
// Object.create(prototype) - без конструктора и DOM.
// Запуск: node test/chat-view-scroll-test.mjs
//
// Зачем: на master терминальных тестов chat-view нет (были только в ветке
// lit-migration для другой реализации). Это safety net для правок скролла.

// --- стабы глобалов ДО импорта модуля ---
globalThis.HTMLElement = class {};
globalThis.customElements = { define: (n, c) => { globalThis.__ChatView = c; } };
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };

await import('../src/chat-view.js');
const ChatView = globalThis.__ChatView;
if (!ChatView) { console.error('FAIL: класс ChatView не пойман через customElements.define'); process.exit(1); }

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

// ULID-подобные монотонные id (26 символов, лексикографически = хронологически)
function mkId(n) {
  return '01' + String(n).padStart(24, '0');
}
function mkMsgs(n, startAt = 0) {
  return Array.from({ length: n }, (_, i) => ({ id: mkId(startAt + i), body: 'm' + (startAt + i), user_id: 'U1' }));
}

// Свежий экземпляр без конструктора: только нужные поля
function newCV(msgs = []) {
  const cv = Object.create(ChatView.prototype);
  cv.messages = msgs.slice();
  cv.viewIds = [];
  return cv;
}

// --- 1. _allIdsSorted: сортированные id ---
{
  const cv = newCV([{ id: mkId(3) }, { id: mkId(1) }, { id: mkId(2) }]);
  const ids = cv._allIdsSorted();
  check('_allIdsSorted сортирует', ids.join() === [mkId(1), mkId(2), mkId(3)].join());
  check('_allIdsSorted длина', ids.length === 3);
}

// --- 2. _atNewestEdge ---
{
  const cv = newCV(mkMsgs(10));
  cv.viewIds = cv._allIdsSorted().slice(-3); // последние 3 = у края
  check('_atNewestEdge true у нижнего края', cv._atNewestEdge() === true);
  cv.viewIds = cv._allIdsSorted().slice(0, 3); // первые 3 = НЕ у края
  check('_atNewestEdge false в истории', cv._atNewestEdge() === false);
  const empty = newCV([]);
  empty.viewIds = [];
  check('_atNewestEdge true при пустом окне', empty._atNewestEdge() === true);
}

// --- 3. _updateViewport bottom/older/newer ---
{
  const cv = newCV(mkMsgs(200)); // 200 сообщений
  const all = cv._allIdsSorted();

  cv._updateViewport('bottom');
  check('bottom: окно = последние SLICE(40)', cv.viewIds.length === 40 && cv.viewIds[cv.viewIds.length - 1] === all[199]);

  cv._updateViewport('older'); // сдвиг вверх
  check('older: окно выросло до LIMIT(80)', cv.viewIds.length === 80);
  check('older: верхний край сместился вверх', all.indexOf(cv.viewIds[0]) < all.indexOf(all[160]));
  check('older: все id в окне уникальны и в порядке', cv.viewIds.join() === all.slice(all.indexOf(cv.viewIds[0]), all.indexOf(cv.viewIds[0]) + 80).join());

  cv._updateViewport('older'); // ещё раз вверх — теперь окно НЕ включает новейший
  check('после 2x older: не у нижнего края', cv._atNewestEdge() === false);
  const topAfter2Older = cv.viewIds[0];
  cv._updateViewport('newer'); // сдвиг вниз
  check('newer: верхний край сместился вниз', all.indexOf(cv.viewIds[0]) > all.indexOf(topAfter2Older));
  check('newer: окно <= LIMIT', cv.viewIds.length <= 80);
}

// --- 4. viewport на малом числе сообщений (< SLICE) ---
{
  const cv = newCV(mkMsgs(5));
  cv._updateViewport('bottom');
  check('bottom при 5 сообщениях: все 5 в окне', cv.viewIds.length === 5);
  check('_atNewestEdge true', cv._atNewestEdge() === true);
  cv._updateViewport('older');
  check('older при 5: без выхода за границы', cv.viewIds.length === 5 && cv.viewIds[0] === mkId(0));
}

// --- 5. порядок сохраняется после «входящего» новейшего ---
{
  const cv = newCV(mkMsgs(10));
  cv.viewIds = cv._allIdsSorted().slice(-40);
  // эмулируем приход нового (в конец, монотонный)
  cv.messages.push({ id: mkId(100), body: 'new', user_id: 'U2' });
  const ids = cv._allIdsSorted();
  check('после нового: max = новейший', ids[ids.length - 1] === mkId(100));
  check('после нового: отсортировано', ids.join() === ids.slice().sort().join());
}

// --- 6. _insertMsg: вставка в позицию, сортировка сохраняется ---
{
  const cv = newCV([{ id: mkId(1) }, { id: mkId(3) }, { id: mkId(5) }]);
  cv._insertMsg({ id: mkId(4) }); // в середину
  check('_insertMsg в середину', cv.messages.map(m => m.id).join() === [mkId(1), mkId(3), mkId(4), mkId(5)].join());
  cv._insertMsg({ id: mkId(0) }); // в начало
  check('_insertMsg в начало', cv.messages[0].id === mkId(0));
  cv._insertMsg({ id: mkId(9) }); // в конец
  check('_insertMsg в конец', cv.messages[cv.messages.length - 1].id === mkId(9));
  check('_insertMsg: порядок полный', cv.messages.map(m => m.id).join() === cv.messages.map(m => m.id).slice().sort().join());
}

// --- 7. мемоизация _allIdsSorted: кеш при неизменном массиве, инвалидация при мутации ---
{
  const cv = newCV(mkMsgs(50));
  const a = cv._allIdsSorted();
  const b = cv._allIdsSorted();
  check('мемо: тот же instance при неизменном массиве', a === b);
  cv._insertMsg({ id: mkId(999) }); // мутация → длина изменилась
  const c = cv._allIdsSorted();
  check('мемо: новый instance после вставки', c !== a);
  check('мемо: отражает новое сообщение', c[c.length - 1] === mkId(999));
  // правка тела (edit) не меняет id/длину → кеш валиден и корректен
  cv.messages[0].body = 'edited';
  const d = cv._allIdsSorted();
  check('мемо: edit тела не ломает (кеш валиден)', d === c && d[0] === cv.messages[0].id);
}

// --- 8. _atNewestEdge через мемо не ломается после вставки новейшего ---
{
  const cv = newCV(mkMsgs(10));
  cv.viewIds = cv._allIdsSorted().slice();
  check('до вставки: у края', cv._atNewestEdge() === true);
  cv._insertMsg({ id: mkId(500) }); // новейший, не в окне
  check('после вставки новейшего: НЕ у края (окно отстало)', cv._atNewestEdge() === false);
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: ${passed} ok, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
