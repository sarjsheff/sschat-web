// crypto.js — E2E через @noble/curves (X25519) + @noble/hashes (HKDF) + @noble/ciphers (AES-GCM)
// Все pure JS — идентично Go/Rust, без Web Crypto (избегает Chromium OperationError)
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { gcm } from '@noble/ciphers/aes.js';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function b64ToBytes(b64) { return new Uint8Array([...atob(b64)].map(c => c.charCodeAt(0))); }
function bytesToB64(bytes) { return btoa(String.fromCharCode(...bytes)); }

function ulidToBytes(ulid) {
  const idx = (c) => { const i = ALPHABET.indexOf(c.toUpperCase()); if (i < 0) throw new Error('invalid ULID char: ' + c); return i; };
  if (ulid.length !== 26) throw new Error('ULID must be 26 chars');
  const out = new Uint8Array(16); let value = idx(ulid[0]) & 0b00111, bits = 3, outPos = 0;
  for (let i = 1; i < 26; i++) {
    value = (value << 5) | idx(ulid[i]); bits += 5;
    while (bits >= 8 && outPos < 16) { bits -= 8; out[outPos++] = (value >>> bits) & 0xff; }
  }
  return out;
}

export function generateIdentity() {
  const priv = x25519.utils.randomSecretKey();
  return { priv, pub: x25519.getPublicKey(priv) };
}

function ecdh(priv, pub) { return x25519.getSharedSecret(priv, pub); }

function hkdfDerive(ikm, salt, info, len) { return hkdf(sha256, ikm, salt, info, len); }

export function deriveKEK(priv, theirPubRaw, roomId) {
  return hkdfDerive(ecdh(priv, theirPubRaw), ulidToBytes(roomId), new TextEncoder().encode('sschat-roomkey'), 32);
}

export function unwrapRoomKey(priv, wrapped, nonce, senderPubRaw, roomId) {
  return gcm(deriveKEK(priv, senderPubRaw, roomId), nonce).decrypt(wrapped);
}

export function decryptBody(body, roomKey) {
  if (!body.startsWith('{')) return body;
  let p; try { p = JSON.parse(body); } catch { return body; }
  if (p.v !== 1) return body;
  try { return new TextDecoder().decode(gcm(roomKey, b64ToBytes(p.n)).decrypt(b64ToBytes(p.c))); }
  catch { return '•••'; }
}

export function encryptBody(plaintext, roomKey) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = gcm(roomKey, nonce).encrypt(new TextEncoder().encode(plaintext));
  return JSON.stringify({ v: 1, c: bytesToB64(ct), n: bytesToB64(nonce) });
}

export function encryptBlob(plain, roomKey) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = gcm(roomKey, nonce).encrypt(plain);
  const out = new Uint8Array(nonce.length + ct.length); out.set(nonce); out.set(ct, nonce.length);
  return out;
}

export function decryptBlob(blob, roomKey) {
  if (blob.length < 28) return null;
  try { return gcm(roomKey, blob.slice(0, 12)).decrypt(blob.slice(12)); }
  catch { return null; }
}

// Web Crypto оставлен только для PBKDF2 (identity backup)
export async function pbkdf2Key(password, salt, iter = 600000) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function aesGcmDecryptRaw(key, nonce, ct) {
  try { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct)); }
  catch { return null; }
}
export async function aesGcmEncrypt(key, plaintext) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  return { nonce, body: new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintext)) };
}
