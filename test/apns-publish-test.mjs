// Тест publishApnsToken: dedup должен учитывать device (did из JWT), не только
// значение токена. Иначе после ре-логина (новый device row на сервере) токен
// никогда не перепосылается и пуши молчат.
// Запуск: node test/apns-publish-test.mjs

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

// --- стабы окружения (до импорта api.js) ---
const lsData = new Map();
globalThis.localStorage = {
  getItem: (k) => (lsData.has(k) ? lsData.get(k) : null),
  setItem: (k, v) => lsData.set(k, String(v)),
  removeItem: (k) => lsData.delete(k),
};

const postCalls = [];
globalThis.fetch = async (url, opts) => {
  postCalls.push({ url, opts });
  return { ok: true, text: async () => '{}' };
};

function fakeJwt(did) {
  const payload = Buffer.from(JSON.stringify({ did, uid: 'U1', knd: 'device' }))
    .toString('base64url');
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.sig`;
}

let apnsToken = 'tok-AAA';
globalThis.__TAURI__ = { core: { invoke: async (cmd) => (cmd === 'read_apns_token' ? apnsToken : null) } };

const { api } = await import('../src/api.js');

// 1. Нет JWT-контекста не важен: с токеном и __TAURI__ — POST уходит
lsData.set('sschat-token', fakeJwt('DEV1'));
let ok = await api.publishApnsToken();
check('первый вызов: POST /devices ушел', ok === true && postCalls.length === 1 && postCalls[0].url.endsWith('/devices'));
check('body содержит токен', postCalls[0] && JSON.parse(postCalls[0].opts.body).token === 'tok-AAA');

// 2. Повторный вызов — дубль, POST не уходит
ok = await api.publishApnsToken();
check('дубль: POST не повторяется', ok === true && postCalls.length === 1);

// 3. Ре-логин: новый JWT с другим did, тот же apns-токен → ОБЯЗАН перепослать
lsData.set('sschat-token', fakeJwt('DEV2'));
ok = await api.publishApnsToken();
check('смена device (ре-логин): токен перепослан', ok === true && postCalls.length === 2);

// 4. Тот же did, новый apns-токен → перепослать
apnsToken = 'tok-BBB';
ok = await api.publishApnsToken();
check('смена apns-токена: перепослан', ok === true && postCalls.length === 3);
check('body содержит новый токен', postCalls[2] && JSON.parse(postCalls[2].opts.body).token === 'tok-BBB');

// 5. Дубль после всего — снова не шлем
ok = await api.publishApnsToken();
check('финальный дубль: POST не повторяется', ok === true && postCalls.length === 3);

// 6. Без __TAURI__ — no-op
delete globalThis.__TAURI__;
ok = await api.publishApnsToken();
check('web без __TAURI__: no-op false', ok === false && postCalls.length === 3);

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: ${passed} ok, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
