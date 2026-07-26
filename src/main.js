import './sschat-app.js';

// Применить сохранённые theme/fontSize до первого render.
(() => {
  const theme = localStorage.getItem('theme') || 'system';
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  const size = localStorage.getItem('fontSize') || 'md';
  document.documentElement.style.fontSize = ({ sm: '13px', md: '14px', lg: '16px' })[size] || '14px';
})();

// iOS WKWebView: клавиатура НЕ уменьшает viewport, а оверлеит контент и нативно
// скроллит к сфокусированному input — из-за чего header чата уезжает за верх экрана.
// VisualViewport API: ужимаем высоту html под видимую область (над клавиатурой),
// а window держим прокрученным наверх (внутренний скролл — в списках, не в window).
(() => {
  const vv = window.visualViewport;
  if (!vv) return;
  const apply = () => {
    document.documentElement.style.height = `${vv.height}px`;
    window.scrollTo(0, 0);
  };
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  apply();
})();

document.getElementById('app').innerHTML = '<sschat-app></sschat-app>';
