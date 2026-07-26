// html.js — безопасное построение разметки сообщений.

export function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Markdown → HTML (подмножество как в Telegram Web).
 * Текст экранируется ПЕРВЫМ делом, разметка накладывается уже на безопасную
 * строку — поэтому вставить теги через содержимое сообщения нельзя.
 * Поддержано: блоки и вставки кода, [текст](url), голые ссылки, жирный,
 * курсив, зачёркнутый, спойлер.
 */
export function renderMarkdown(text) {
  let s = escapeHtml(text || '');
  const blocks = [];
  // Код вынимаем первым: внутри него разметка не разбирается
  s = s.replace(/```([\s\S]*?)```/g, (m, c) => { blocks.push(`<pre>${c.replace(/^\n|\n$/g, '')}</pre>`); return `${blocks.length - 1}`; });
  s = s.replace(/`([^`\n]+)`/g, (m, c) => { blocks.push(`<code>${c}</code>`); return `${blocks.length - 1}`; });
  const link = (url, label) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, t, u) => link(u, t));
  s = s.replace(/(^|[\s])(https?:\/\/[^\s<]+)/g, (m, pre, u) => pre + link(u, u));
  s = s.replace(/\*\*([^\n]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^\n]+?)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^\w*])\*([^\s*][^*\n]*?)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w_])_([^\s_][^_\n]*?)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^\n]+?)~~/g, '<s>$1</s>');
  s = s.replace(/\|\|([^\n]+?)\|\|/g, '<span class="spoiler">$1</span>');
  return s.replace(/(\d+)/g, (m, i) => blocks[+i]);
}
