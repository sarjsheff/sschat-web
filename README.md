# sschat-web

Веб-клиент мессенджера sschat: сквозное шифрование, лента с виртуальным окном,
SSE-стрим событий, офлайн-кеш в IndexedDB. Ванильные Web Components + Lit, без
роутера и стейт-менеджера. Собирается как веб-приложение и как desktop/iOS-шелл
через Tauri 2.

## Стек

| Слой | Решение |
|---|---|
| UI | Web Components, [Lit](https://lit.dev) 3 |
| Сборка | Vite 6 |
| Крипто | [@noble](https://github.com/paulmillr/noble-curves) — X25519, HKDF-SHA256, AES-GCM |
| Хранилище | IndexedDB через `idb-keyval` |
| Транспорт | `fetch` + SSE (`/events`) |
| Нативная оболочка | Tauri 2 (macOS, iOS) |

Web Crypto используется только для импорта AES-ключей; сам обмен ключами -
чистый JS, чтобы поведение совпадало с Go/Rust-реализациями сервера.

## Запуск

```sh
npm install
cp .env.example .env      # укажите адрес своего sschat-сервера
npm run dev               # http://localhost:1421
npm run build             # сборка в dist/
```

`VITE_API_BASE` задает адрес сервера на этапе сборки. Он не обязателен: адрес
можно ввести на экране входа - он сохранится в `localStorage` под ключом
`sschat-base-url` и будет иметь приоритет над сборочным значением.

## Тесты

```sh
node test/chat-view-scroll-test.mjs
node test/chat-view-scroll-anchor-test.mjs
node test/chat-view-scroll-wkwebview-test.mjs
node test/apns-publish-test.mjs
```

Все четыре автономны: стабят DOM и импортируют настоящие модули, сервер не
нужен. Три из них - регрессионные тесты скролла ленты, включая модель WKWebView,
где `querySelector` по атрибуту в Shadow DOM не находит существующие строки.

## Структура

```
src/
  sschat-app.js     корневой компонент, стадии loading → login → code → main
  login-view.js     вход по логину/паролю
  code-view.js      подтверждение кодом
  sidebar-view.js   список комнат
  chat-view.js      лента сообщений: виртуальное окно, пагинация, E2E
  room-info.js      участники и настройки комнаты
  settings-view.js  профиль, тема, размер шрифта
  api.js            HTTP-клиент
  sse.js            SSE с exponential backoff
  crypto.js         X25519 + HKDF + AES-GCM
  identity.js       ключи устройства в IndexedDB
  room-key.js       получение и кеш комнатных ключей
  cache.js          офлайн-кеш сообщений, комнат, пользователей
  viewport.js       расчет видимого окна ленты
src-tauri/          Tauri-шелл, APNs-мост для iOS
```

## Шифрование

У устройства своя пара X25519 (`identity.js`, лежит в IndexedDB). У комнаты -
симметричный AES-256-GCM ключ, который сервер раздает участникам завернутым:
ECDH к публичному ключу получателя, HKDF-SHA256 с ULID комнаты в качестве info,
AES-GCM поверх. Сервер видит только шифротекст сообщений и вложений.

Восстановление identity из серверного бэкапа реализовано в
`identity.restoreFromBackup(password, backup)`, но UI для ввода пароля пока не
подключен - на новом устройстве генерируется новая пара, и старая переписка не
расшифруется.

## Сборка под iOS

```sh
cargo tauri ios init
cargo tauri ios build
```

Перед сборкой подставьте свой Apple Team ID вместо `YOUR_TEAM_ID` и bundle
identifier вместо `com.example.SSChat`:

- `src-tauri/tauri.conf.json` - `identifier`, `bundle.iOS.developmentTeam`
- `src-tauri/gen/apple/project.yml` - `bundleIdPrefix`, `PRODUCT_BUNDLE_IDENTIFIER`, `DEVELOPMENT_TEAM`
- `src-tauri/gen/apple/app.xcodeproj/project.pbxproj` - то же самое

Пуши: `src-tauri/gen/apple/Sources/app/push.m` перехватывает APNs device token
через swizzling AppDelegate и пишет его в `~/Documents/sschat/apns_token`;
Rust-команда `read_apns_token` отдает его в JS, тот постит на `/devices`.

## Лицензия

MIT, см. [LICENSE](LICENSE).
