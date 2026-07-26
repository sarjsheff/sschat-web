// album-layout.js — мозаичная раскладка альбомов, порт алгоритма Telegram/tdesktop.
// Чистые вычисления: ни DOM, ни состояния.

/**
 * Разложить n картинок по их пропорциям.
 * @param {number[]} ratiosIn - width/height каждой картинки
 * @returns {{items: {x,y,w,h}[], width: number, height: number}}
 *
 * Для 2/3/4 картинок — специальные схемы по пропорциям (широкие в столбик,
 * узкие в ряд и т.д.), для 5+ — justified rows: ряды на всю ширину, высота
 * ряда выводится из суммы пропорций.
 */
export function albumLayout(ratiosIn, maxW = 320, maxH = 320, spacing = 2) {
  const n = ratiosIn.length;
  const ratios = ratiosIn.map(r => (r && r > 0) ? r : 1);
  // w — широкая, n — узкая (портрет), q — примерно квадрат
  const proportions = ratios.map(r => r > 1.2 ? 'w' : (r < 0.8 ? 'n' : 'q')).join('');
  const avg = ratios.reduce((s, r) => s + r, 0) / n;
  const items = [];
  const R = (x) => Math.round(x);
  const push = (x, y, w, h) => items.push({ x: R(x), y: R(y), w: R(w), h: R(h) });

  if (n === 2) {
    if (proportions === 'ww' && avg > 1.4 && (ratios[1] - ratios[0]) < 0.2) {
      const w = maxW, h0 = w / ratios[0], h1 = w / ratios[1]; // две строки на всю ширину
      push(0, 0, w, h0); push(0, h0 + spacing, w, h1);
      return { items, width: maxW, height: R(h0 + spacing + h1) };
    }
    if (proportions === 'ww' || proportions === 'qq') {
      const w = (maxW - spacing) / 2, h = Math.min(w / ratios[0], w / ratios[1]); // 50/50
      push(0, 0, w, h); push(w + spacing, 0, w, h);
      return { items, width: maxW, height: R(h) };
    }
    const h = (maxW - spacing) / (ratios[0] + ratios[1]); // разные ширины, общая высота
    push(0, 0, h * ratios[0], h); push(h * ratios[0] + spacing, 0, h * ratios[1], h);
    return { items, width: maxW, height: R(h) };
  }

  if (n === 3) {
    if (proportions[0] === 'n' || ratios[0] < avg) {
      const H = maxH, rH = (H - spacing) / 2; // большая слева, две стопкой справа
      const rightW = Math.max(rH * ratios[1], rH * ratios[2]);
      const leftW = Math.max(maxW * 0.5, maxW - spacing - rightW);
      const rw = maxW - spacing - leftW;
      push(0, 0, leftW, H);
      push(leftW + spacing, 0, rw, rH);
      push(leftW + spacing, rH + spacing, rw, rH);
      return { items, width: maxW, height: H };
    }
    const topH = Math.min(maxW / ratios[0], maxH * 0.66); // верхняя на всю ширину, две снизу
    const bw = (maxW - spacing) / 2, bh = Math.min(bw / ratios[1], bw / ratios[2]);
    push(0, 0, maxW, topH);
    push(0, topH + spacing, bw, bh);
    push(bw + spacing, topH + spacing, bw, bh);
    return { items, width: maxW, height: R(topH + spacing + bh) };
  }

  if (n === 4) {
    if (proportions[0] === 'w') {
      const topH = Math.min(maxW / ratios[0], maxH * 0.66); // верхняя на всю ширину, три снизу
      const h2 = (maxW - 2 * spacing) / (ratios[1] + ratios[2] + ratios[3]);
      const w1 = h2 * ratios[1], w2 = h2 * ratios[2], w3 = h2 * ratios[3];
      push(0, 0, maxW, topH);
      push(0, topH + spacing, w1, h2);
      push(w1 + spacing, topH + spacing, w2, h2);
      push(w1 + w2 + 2 * spacing, topH + spacing, w3, h2);
      return { items, width: maxW, height: R(topH + spacing + h2) };
    }
    const H = maxH, rH = (H - 2 * spacing) / 3; // большая слева, три стопкой справа
    const rightW = Math.max(rH * ratios[1], rH * ratios[2], rH * ratios[3]);
    const leftW = Math.max(maxW * 0.5, maxW - spacing - rightW);
    const rw = maxW - spacing - leftW;
    push(0, 0, leftW, H);
    for (let i = 0; i < 3; i++) push(leftW + spacing, i * (rH + spacing), rw, rH);
    return { items, width: maxW, height: H };
  }

  // 5+: justified rows
  const rows = []; let cur = [], curR = 0;
  const rowAspect = maxW / (maxH / 2);
  for (let i = 0; i < n; i++) {
    cur.push(ratios[i]); curR += ratios[i];
    if (curR >= rowAspect) { rows.push(cur); cur = []; curR = 0; }
  }
  if (cur.length) rows.push(cur);
  let y = 0;
  for (const row of rows) {
    const rr = row.reduce((s, r) => s + r, 0);
    const rowH = (maxW - spacing * (row.length - 1)) / rr;
    let x = 0;
    for (const r of row) { push(x, y, rowH * r, rowH); x += rowH * r + spacing; }
    y += rowH + spacing;
  }
  return { items, width: maxW, height: R(y - spacing) };
}

/**
 * Вписать w×h в лимиты с сохранением пропорций (аналог calculateDimensions в
 * telegram-tt). Нужен, чтобы зарезервировать место под картинку ДО загрузки —
 * иначе лента прыгает, когда картинка появляется.
 * @returns {{w,h}|null} null если размеры неизвестны
 */
export function fitDimensions(w, h, maxW = 260, maxH = 320) {
  if (!w || !h || w <= 0 || h <= 0) return null;
  const r = Math.min(maxW / w, maxH / h, 1);
  return { w: Math.round(w * r), h: Math.round(h * r) };
}
