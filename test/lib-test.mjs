// Тесты чистых модулей, вынесенных из chat-view.js: разметка, раскладка
// альбомов, форматтеры. Ни DOM, ни сети — запуск: node test/lib-test.mjs
import { escapeHtml, renderMarkdown } from '../src/lib/html.js';
import { albumLayout, fitDimensions } from '../src/lib/album-layout.js';
import { formatSize, dayKey, dayLabel, attKind, mimeFor, extOf } from '../src/lib/format.js';

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
function eq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) console.log(`    ожидалось ${JSON.stringify(expected)}, получено ${JSON.stringify(actual)}`);
  check(name, ok);
}

console.log('# escapeHtml');
eq('теги экранируются', escapeHtml('<b>&</b>'), '&lt;b&gt;&amp;&lt;/b&gt;');
eq('null → пустая строка', escapeHtml(null), '');

console.log('# renderMarkdown');
eq('жирный', renderMarkdown('**жирно**'), '<strong>жирно</strong>');
eq('курсив', renderMarkdown('_курсив_'), '<em>курсив</em>');
eq('зачёркнутый', renderMarkdown('~~нет~~'), '<s>нет</s>');
eq('спойлер', renderMarkdown('||секрет||'), '<span class="spoiler">секрет</span>');
eq('инлайн-код', renderMarkdown('вот `code` тут'), 'вот <code>code</code> тут');
eq('блок кода', renderMarkdown('```\nx=1\n```'), '<pre>x=1</pre>');
check('внутри кода разметка не парсится', renderMarkdown('`**нет**`') === '<code>**нет**</code>');
check('ссылка', renderMarkdown('[тут](https://e.com)').includes('href="https://e.com"'));
check('голый url автолинкуется', renderMarkdown('см https://e.com').includes('<a href="https://e.com"'));
check('XSS: теги в тексте экранированы', !renderMarkdown('<img src=x onerror=alert(1)>').includes('<img'));
check('XSS: тег внутри жирного', renderMarkdown('**<script>**') === '<strong>&lt;script&gt;</strong>');
// Плейсхолдеры блоков кода помечаются  — иначе подстановка поймала бы
// любое число в тексте (регрессия при выносе модуля).
eq('числа в тексте не съедаются', renderMarkdown('цена 42 рубля'), 'цена 42 рубля');
eq('число рядом с кодом', renderMarkdown('`a` 0 `b` 1'), '<code>a</code> 0 <code>b</code> 1');

console.log('# fitDimensions');
eq('вписывается по ширине', fitDimensions(520, 320, 260, 320), { w: 260, h: 160 });
eq('мелкая не растягивается', fitDimensions(100, 50, 260, 320), { w: 100, h: 50 });
eq('нет размеров → null', fitDimensions(0, 100), null);
eq('undefined → null', fitDimensions(undefined, undefined), null);

console.log('# albumLayout');
for (const n of [2, 3, 4, 5, 7, 10]) {
  const ratios = Array.from({ length: n }, (_, i) => 1 + (i % 3) * 0.4);
  const lay = albumLayout(ratios);
  check(`${n} шт: элементов ровно ${n}`, lay.items.length === n);
  check(`${n} шт: положительные размеры`, lay.items.every(r => r.w > 0 && r.h > 0));
  check(`${n} шт: в пределах ширины`, lay.items.every(r => r.x >= 0 && r.x + r.w <= lay.width + 1));
  check(`${n} шт: высота положительна`, lay.height > 0);
}
check('битые пропорции не роняют', albumLayout([0, -1, NaN, undefined]).items.length === 4);
// Две широкие с avg > 1.4 идут в столбик на всю ширину, иначе — рядом 50/50
eq('две широкие — столбиком', albumLayout([1.5, 1.5], 320, 320, 2).items.map(i => i.w), [320, 320]);
eq('две умеренные — рядом 50/50', albumLayout([1.3, 1.3], 320, 320, 2).items.map(i => i.w), [159, 159]);

console.log('# format');
eq('байты', formatSize(512), '512 B');
eq('килобайты', formatSize(2048), '2 KB');
eq('мегабайты', formatSize(3 * 1024 * 1024), '3.0 MB');
eq('ноль → пусто', formatSize(0), '');
eq('расширение', extOf('видео.MP4'), 'mp4');
eq('без расширения', extOf('файл'), 'файл');
eq('расширение важнее mime', attKind({ name: 'clip.mp4', mime: 'image/png' }), 'video');
eq('mime когда расширения нет', attKind({ name: 'noext', mime: 'audio/ogg' }), 'audio');
eq('картинка', attKind({ name: 'a.jpg' }), 'image');
eq('прочее → file', attKind({ name: 'a.zip', mime: 'application/zip' }), 'file');
eq('mime по расширению', mimeFor({ name: 'clip.mp4', mime: 'image/png' }), 'video/mp4');
eq('mime по умолчанию', mimeFor({ name: 'x.bin' }), 'application/octet-stream');

const now = new Date();
eq('сегодня', dayLabel(now.toISOString()), 'Сегодня');
const yest = new Date(now); yest.setDate(now.getDate() - 1);
eq('вчера', dayLabel(yest.toISOString()), 'Вчера');
check('ключ дня одинаков в пределах суток',
  dayKey('2026-03-05T01:00:00') === dayKey('2026-03-05T23:00:00'));
check('ключ дня различается между сутками',
  dayKey('2026-03-05T23:00:00') !== dayKey('2026-03-06T01:00:00'));

console.log(`\nPASS: ${passed} ok, ${failed} fail`);
process.exit(failed ? 1 : 0);
