// format.js — форматирование дат/размеров и определение типа вложения.

export function formatSize(n) {
  if (!n) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

/** Ключ календарного дня — для разделителей в ленте. */
export function dayKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function dayLabel(iso) {
  const d = new Date(iso), now = new Date();
  const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, now)) return 'Сегодня';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (same(d, yesterday)) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

export function extOf(name) {
  return ((name || '').split('.').pop() || '').toLowerCase();
}

const VIDEO_EXT = ['mp4', 'mov', 'webm', 'm4v', 'avi', 'mkv', 'ogv'];
const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'opus', 'flac'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic', 'heif', 'avif', 'svg'];

/**
 * Тип вложения: 'image' | 'video' | 'audio' | 'file'.
 * Расширение имеет приоритет над mime — боты присылают видео с mime image/png.
 */
export function attKind(a) {
  const e = extOf(a && a.name);
  if (VIDEO_EXT.includes(e)) return 'video';
  if (AUDIO_EXT.includes(e)) return 'audio';
  if (IMAGE_EXT.includes(e)) return 'image';
  const m = (a && a.mime) || '';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('image/')) return 'image';
  return 'file';
}

const MIME_BY_EXT = {
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/mp4',
  mkv: 'video/x-matroska', ogv: 'video/ogg',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  aac: 'audio/aac', opus: 'audio/opus', flac: 'audio/flac',
};

/** Mime для blob-URL: по расширению, иначе присланный. Иначе плеер не сыграет mp4 с mime image/png. */
export function mimeFor(a) {
  return MIME_BY_EXT[extOf(a && a.name)] || (a && a.mime) || 'application/octet-stream';
}
