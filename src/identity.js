// identity.js — X25519 ключи через @noble/curves (raw bytes, не Web Crypto)
import { get, set, createStore } from 'idb-keyval';
import { generateIdentity, pbkdf2Key, aesGcmEncrypt, aesGcmDecryptRaw } from './crypto.js';
import { api, getToken } from './api.js';

const idStore = createStore('sschat-identity', 'keys');

export async function loadOrCreateIdentity() {
  const stored = await get('identity', idStore);
  if (stored) return { priv: b64(stored.priv_b64), pub: b64(stored.pub_b64) };

  const kp = generateIdentity();
  await set('identity', { priv_b64: btoa(String.fromCharCode(...kp.priv)), pub_b64: btoa(String.fromCharCode(...kp.pub)) }, idStore);

  const token = getToken();
  if (token) {
    try { await api.registerDevice(btoa(String.fromCharCode(...kp.pub))); }
    catch (e) { console.error('Failed to publish pub_key:', e); }
  }
  return kp;
}

export async function restoreFromBackup(password, backup) {
  const salt = b64(backup.salt), nonce = b64(backup.nonce);
  const wrapped = b64(backup.wrapped);
  const kek = await pbkdf2Key(password, salt, backup.kdf_iter || 600000);
  const priv = await aesGcmDecryptRaw(kek, nonce, wrapped);
  if (!priv || priv.length !== 32) throw new Error('Bad password or corrupted backup (got ' + (priv?.length || 0) + ' bytes)');
  await set('identity', { priv_b64: btoa(String.fromCharCode(...priv)), pub_b64: backup.pub_key }, idStore);
  return { priv, pub: b64(backup.pub_key) };
}

export async function createBackup(password, priv, pub) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const kek = await pbkdf2Key(password, salt);
  const { nonce, body } = await aesGcmEncrypt(kek, priv); // priv is raw Uint8Array
  return { wrapped: btoa(String.fromCharCode(...body)), nonce: btoa(String.fromCharCode(...nonce)), salt: btoa(String.fromCharCode(...salt)), kdf_iter: 600000, pub_key: btoa(String.fromCharCode(...pub)) };
}

function b64(s) { return new Uint8Array([...atob(s)].map(c => c.charCodeAt(0))); }
