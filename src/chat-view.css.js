// chat-view.css.js — стили ленты сообщений. Вынесены из компонента: 125 строк
// CSS внутри шаблонной строки мешали читать логику.
// Подключаются в Shadow DOM компонента <chat-view>.

export const CHAT_VIEW_CSS = `
:host { display: flex; flex-direction: column; height: 100%; background: var(--bg,#0f0f23); color: var(--fg,#eee); font: 14px system-ui; position: relative; }
.header { padding: 8px 14px; border-bottom: 1px solid #ddd; background: #fff; color: #000; display: flex; align-items: center; gap: 8px; cursor: pointer; flex-shrink: 0; }
.back-btn { flex: 0 0 auto; width: 30px; height: 30px; padding: 0; margin: 0; border: none; background: none; color: #000; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 6px; }
.back-btn:hover { background: rgba(0,0,0,.06); }
.head-avatar { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
.head-text { min-width: 0; flex: 1; }
.room-name { font-weight: 600; }
.scroll { flex: 1; overflow-y: auto; overflow-anchor: none; padding: 8px 12px; display: flex; flex-direction: column; gap: 2px;
  background-color: rgb(153, 186, 146); background-position: 50% 50%; background-repeat: no-repeat; background-size: 100% 100%; }
.scroll.drag-over { outline: 3px dashed #4a9eff; outline-offset: -6px; }
/* ширина колонки сообщений как telegram-tt: 728px до 1920px, ≥1921px → 50vw */
#list { display: flex; flex-direction: column; gap: 2px; width: 100%; max-width: 728px; margin: 0 auto; box-sizing: border-box; }
@media (min-width: 1921px) { #list { max-width: 50vw; } }
#list > :first-child { margin-top: auto; }
/* Строка сжимается по содержимому (бабл+кнопка) и прижимается к краю целиком */
.msg-row { display: flex; align-items: center; gap: 4px; position: relative; max-width: 88%; }
.msg-row.mine { align-self: flex-end; }
.msg-row.their { align-self: flex-start; }
.chat-bubble { padding: 6px 10px; border-radius: 8px; background: #fff; color: #000; position: relative; box-sizing: border-box; min-width: 80px; }
/* бабл с картинкой — по размеру картинки. .mine:has (0,3,0) перебивает .chat-bubble.mine{max-width:80%} */
.chat-bubble:has(.att-wrap), .chat-bubble.mine:has(.att-wrap) { max-width: none; }
.bubble-head { display: flex; align-items: center; gap: 6px; width: 100%; }
.bubble-head .name { min-width: 0; }
/* глобальный CSS приложения навязывает кнопке position:absolute — перебиваем */
.bubble-head .msg-menu-btn { position: static !important; left: auto !important; right: auto !important; flex: 0 0 auto; margin-left: auto; }
.msg-menu-btn { flex: 0 0 auto; width: 22px; height: 22px; min-width: 22px; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; opacity: .6; background: none; border: none; color: #000; font-size: 16px; line-height: 1; cursor: pointer; padding: 0; margin: 0; border-radius: 4px; }
.msg-menu-btn:hover { opacity: 1; background: rgba(0,0,0,.08); }
.msg-menu { position: fixed; top: 0; left: 0; z-index: 1000; display: flex; flex-direction: column; background: #23234a; border: 1px solid #3a3a6a; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,.5); overflow: hidden; min-width: 130px; }
.msg-menu button { background: none; border: none; color: #eee; text-align: left; padding: 8px 12px; cursor: pointer; font-size: 13px; white-space: nowrap; }
.msg-menu button:hover { background: #0f3460; }
.msg-menu button.danger { color: #ff8080; }
.edited { font-size: 9px; color: #777; font-style: italic; }
.chat-bubble.mine { background: rgb(220, 248, 197); color: #000; }
.chat-bubble.plaintext { border-left: 3px solid #f4a236; }
/* Анимация нового сообщения — выплывает снизу как в Telegram Web */
.msg-row.new-msg { animation: msgSlideIn 0.25s ease-out; }
@keyframes msgSlideIn {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
.plaintext-badge { font-size: 11px; margin-right: 2px; opacity: .8; }
/* Skeleton loading — мерцающие плейсхолдеры как в Telegram Web */
.skeleton-list { display: flex; flex-direction: column; gap: 6px; padding: 8px 0; max-width: 728px; margin: 0 auto; width: 100%; }
.skel-msg { display: flex; flex-direction: column; gap: 4px; padding: 8px 12px; border-radius: 8px; background: rgba(255,255,255,.4); max-width: 88%; }
.skel-bar { height: 10px; border-radius: 4px; background: rgba(255,255,255,.7); }
.skel-msg, .skel-bar { animation: skelPulse 1.5s ease-in-out infinite; }
.skel-bar:nth-child(2) { margin-top: 4px; width: 80% !important; opacity: .6; }
@keyframes skelPulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
}
.name { font-size: 13px; color: #7eb8ff; margin-bottom: 2px; }
.msg-text { word-break: break-word; white-space: pre-wrap; }
.msg-text code { background: rgba(0,0,0,.08); padding: 1px 4px; border-radius: 4px; font-family: ui-monospace, monospace; font-size: .92em; }
.msg-text pre { background: rgba(0,0,0,.08); padding: 8px 10px; border-radius: 6px; overflow-x: auto; margin: 4px 0; white-space: pre; font-family: ui-monospace, monospace; font-size: .9em; }
.msg-text a { color: #1a73e8; text-decoration: none; }
.msg-text a:hover { text-decoration: underline; }
.msg-text s { opacity: .7; }
.msg-text .spoiler { background: #555; color: transparent; border-radius: 3px; cursor: pointer; transition: color .15s; }
.msg-text .spoiler.revealed { background: rgba(0,0,0,.08); color: inherit; }
.att-wrap { display: flex; flex-direction: column; gap: 4px; margin-bottom: 4px; }
.att-box { position: relative; border-radius: 6px; overflow: hidden; background: #1e2a4a; cursor: pointer; }
/* Галерея-мозаика (альбомы, как telegram-tt) — абсолютное позиционирование из _albumLayout */
.att-gallery { border-radius: 8px; overflow: hidden; }
.att-gallery .att-box { border-radius: 0; }
.att-blur { position: absolute; inset: 0; z-index: 0; background-size: cover; background-position: center; filter: blur(12px); transform: scale(1.15); }
.att-img { position: relative; z-index: 1; width: 100%; height: 100%; object-fit: cover; display: block; opacity: 0; }
.att-img.shown { opacity: 1; }
.att-progress { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: rgba(255,255,255,.15); }
.att-progress.hidden { display: none; }
.att-bar { height: 100%; width: 0; background: #4a9eff; transition: width .12s linear; }
.att-media { max-width: 280px; max-height: 320px; border-radius: 6px; display: block; }
.att-file { display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: rgba(0,0,0,.06); border-radius: 8px; cursor: pointer; max-width: 260px; }
.att-file:hover { background: rgba(0,0,0,.12); }
.att-file-icon { flex: 0 0 auto; width: 38px; height: 38px; border-radius: 8px; background: #4a9eff; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; }
.att-file-meta { min-width: 0; }
.att-file-name { font-size: 13px; color: #000; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.att-file-size { font-size: 11px; color: #666; }
.att-broken { background: #3a2030; }
.att-fail { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #ff9090; font-size: 12px; pointer-events: none; }
.att-sending { position: relative; opacity: .75; }
.sending-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.35); color: #fff; font-size: 13px; border-radius: 6px; pointer-events: none; }
.lightbox { position: fixed; inset: 0; z-index: 2000; background: rgba(0,0,0,.88); display: none; align-items: center; justify-content: center; cursor: zoom-out; }
.lightbox.visible { display: flex; }
.lb-img { max-width: 92vw; max-height: 92vh; object-fit: contain; border-radius: 4px; cursor: grab; will-change: transform; touch-action: none; }
.lb-spinner { color: #ccc; font-size: 14px; }
.lb-close, .lb-nav { box-sizing: border-box; padding: 0; margin: 0; border: none; border-radius: 50%; background: rgba(255,255,255,.15); color: #fff; cursor: pointer; z-index: 2; display: flex; align-items: center; justify-content: center; -webkit-appearance: none; }
.lb-close:hover, .lb-nav:hover { background: rgba(255,255,255,.28); }
.lb-close { position: fixed; top: calc(16px + env(safe-area-inset-top, 0px)); right: 20px; width: 40px; height: 40px; }
.lb-nav { position: fixed; top: 50%; transform: translateY(-50%); width: 48px; height: 48px; }
.lb-prev { left: 20px; }
.lb-next { right: 20px; }
.send-dialog { position: fixed; inset: 0; z-index: 2100; background: rgba(0,0,0,.6); display: none; align-items: center; justify-content: center; }
.send-dialog.visible { display: flex; }
.sd-box { background: #1a1a2e; border: 1px solid #333; border-radius: 12px; padding: 16px; width: min(420px, 90vw); max-height: 86vh; display: flex; flex-direction: column; gap: 12px; box-shadow: 0 8px 32px rgba(0,0,0,.6); }
.sd-title { font-weight: 600; font-size: 15px; }
.sd-previews { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; overflow-y: auto; }
.sd-item { position: relative; }
.sd-thumb { max-width: 120px; max-height: 160px; border-radius: 8px; object-fit: cover; background: #0d0d20; display: block; }
.sd-fileicon { width: 110px; height: 90px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; background: #2a2a40; color: #fff; font-weight: 700; font-size: 13px; padding: 6px; }
.sd-fileicon span { font-weight: 400; font-size: 11px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sd-del { position: absolute; top: 4px; right: 4px; width: 22px; height: 22px; box-sizing: border-box; padding: 0; margin: 0; border-radius: 50%; border: none; background: rgba(0,0,0,.6); color: #fff; font: 16px/1 system-ui; cursor: pointer; display: flex; align-items: center; justify-content: center; text-align: center; }
.sd-del:hover { background: rgba(220,40,40,.9); }
.sd-add { align-self: flex-start; cursor: pointer; color: #4a9eff; font-size: 13px; user-select: none; }
.sd-caption { padding: 10px 12px; border-radius: 8px; border: 1px solid #333; background: #0f0f23; color: #eee; font-size: 14px; }
.sd-actions { display: flex; gap: 8px; justify-content: flex-end; }
.sd-actions button { padding: 8px 18px; border-radius: 8px; border: none; cursor: pointer; font-size: 14px; }
.sd-cancel { background: #2a2a40; color: #ccc; }
.sd-send { background: #4a9eff; color: #fff; font-weight: 600; }
.time { font-size: 10px; color: rgb(69, 175, 84); float: right; margin-left: 8px; }
.status { color: rgb(69, 175, 84); margin-left: 2px; }
.status.read { color: rgb(69, 175, 84); font-weight: 600; letter-spacing: -0.35em; padding-right: 0.35em; } /* ✓✓ наползают */
.status.sending { color: #999; font-size: 10px; } /* часики — отправляется */
.status.failed { color: #e55; font-weight: 600; } /* не отправлено */
.day-sep { text-align: center; font-size: 11px; color: #555; padding: 8px 0; }
.loading { text-align: center; padding: 20px; color: #555; }
.typing { min-height: 14px; font-size: 12px; color: #7eb8ff; font-style: italic; }
.input-row { display: flex; gap: 6px; padding: 8px 10px; border-top: 1px solid #ddd; background: #fff; align-items: center; flex-shrink: 0; }
.att-btn { flex: 0 0 auto; cursor: pointer; font-size: 20px; opacity: .7; user-select: none; padding: 0 4px; }
.att-btn:hover { opacity: 1; }
.input-row textarea { flex: 1; padding: 8px 12px; border-radius: 6px; border: 1px solid #ccc; background: #f5f5f5; color: #000; font: inherit; resize: none; line-height: 1.3; max-height: 120px; overflow-y: auto; }
.input-row button { padding: 8px 16px; border-radius: 6px; border: none; background: #0f3460; color: #eee; cursor: pointer; }
.fab { position: absolute; bottom: 70px; right: 28px; width: 40px; height: 40px; border-radius: 50%; background: #4a9eff; border: none; color: #fff; font-size: 20px; cursor: pointer; box-shadow: 0 2px 10px rgba(0,0,0,.5); display: none; z-index: 10; }
.fab.has-count { font-size: 14px; font-weight: 600; }
.fab:hover { background: #6cb0ff; }
.fab.visible { display: flex; align-items: center; justify-content: center; }
`;
