// config.js — единственный источник адреса сервера.
//
// Приоритет: настройка пользователя (localStorage) → сборочный VITE_API_BASE
// (см. .env.example) → пусто. Пусто означает «спросить на экране входа».
//
// Читается на каждый запрос, а не один раз при импорте: login-view сохраняет
// введенный адрес прямо перед POST /login, и константа отдала бы старое значение.

const BUILD_BASE = import.meta.env?.VITE_API_BASE || '';

export function getBase() {
  try { return localStorage.getItem('sschat-base-url') || BUILD_BASE; }
  catch { return BUILD_BASE; }
}

export function setBaseURL(url) {
  try { localStorage.setItem('sschat-base-url', url); } catch {}
}
