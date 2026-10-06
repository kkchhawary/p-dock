// Vault encryption — sab kuch browser ke andar (WebCrypto). Google Drive tak sirf taala-band data jaata hai.
//
// Ek random "vault key" (AES-256-GCM) saara data encrypt karti hai. Woh key khud teen tarah se lock hoti hai:
//   1. vault password se (PBKDF2, 600k rounds)
//   2. recovery code se (password bhoolne par)
//   3. Face ID / Touch ID passkey se (WebAuthn PRF), har device par alag
// Drive par sirf yeh locked copies rehti hain — asli key kabhi nahi.

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();
const PBKDF2_ROUNDS = 600_000;

export const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

export function toB64(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}
export function fromB64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// ---------- vault key ----------
export async function newVaultKey() {
  return subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

const importAes = (raw, extractable = false) =>
  subtle.importKey('raw', raw, { name: 'AES-GCM' }, extractable, ['encrypt', 'decrypt']);

// ---------- data encrypt/decrypt ----------
// Format: "PD1" | iv(12) | ciphertext+tag
const MAGIC = enc.encode('PD1');

export async function encryptBytes(key, bytes) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(3 + 12 + ct.length);
  out.set(MAGIC, 0);
  out.set(iv, 3);
  out.set(ct, 15);
  return out;
}

export async function decryptBytes(key, blob) {
  blob = new Uint8Array(blob);
  if (blob[0] !== MAGIC[0] || blob[1] !== MAGIC[1] || blob[2] !== MAGIC[2]) throw new Error('Yeh P-Dock ki file nahi hai');
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: blob.subarray(3, 15) }, key, blob.subarray(15));
  return new Uint8Array(pt);
}

export const encryptJson = (key, obj) => encryptBytes(key, enc.encode(JSON.stringify(obj)));
export const decryptJson = async (key, blob) => JSON.parse(dec.decode(await decryptBytes(key, blob)));

// ---------- key wrapping ----------
async function wrapWith(wrappingKeyRaw, vaultKey) {
  const wk = await importAes(wrappingKeyRaw);
  const raw = new Uint8Array(await subtle.exportKey('raw', vaultKey));
  return toB64(await encryptBytes(wk, raw));
}

async function unwrapWith(wrappingKeyRaw, wrapped) {
  const wk = await importAes(wrappingKeyRaw);
  const raw = await decryptBytes(wk, fromB64(wrapped));
  return importAes(raw, true);
}

async function passwordKey(password, salt, rounds = PBKDF2_ROUNDS) {
  const base = await subtle.importKey('raw', enc.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds }, base, 256));
}

// Recovery code: 24 akshar, padhne mein aasaan (0/O, 1/I jaise confusing akshar nahi)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newRecoveryCode() {
  const bytes = randomBytes(24);
  const chars = [...bytes].map((b) => ALPHABET[b % 32]).join('');
  return chars.match(/.{4}/g).join('-');
}
const normalizeCode = (c) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');

export async function createVaultHeader(vaultKey, password, recoveryCode) {
  const pwSalt = randomBytes(16);
  const rcSalt = randomBytes(16);
  return {
    v: 1,
    created: new Date().toISOString(),
    password: { salt: toB64(pwSalt), rounds: PBKDF2_ROUNDS, key: await wrapWith(await passwordKey(password, pwSalt), vaultKey) },
    recovery: { salt: toB64(rcSalt), rounds: PBKDF2_ROUNDS, key: await wrapWith(await passwordKey(normalizeCode(recoveryCode), rcSalt), vaultKey) },
    passkeys: [],
  };
}

export async function unlockWithPassword(header, password) {
  try {
    const p = header.password;
    return await unwrapWith(await passwordKey(password, fromB64(p.salt), p.rounds), p.key);
  } catch {
    throw new Error('Password galat hai');
  }
}

export async function unlockWithRecovery(header, code) {
  try {
    const r = header.recovery;
    return await unwrapWith(await passwordKey(normalizeCode(code), fromB64(r.salt), r.rounds), r.key);
  } catch {
    throw new Error('Recovery code galat hai');
  }
}

// Naya password (purana ya recovery code se khulne ke baad)
export async function changePassword(header, vaultKey, newPassword) {
  const salt = randomBytes(16);
  return {
    ...header,
    password: { salt: toB64(salt), rounds: PBKDF2_ROUNDS, key: await wrapWith(await passwordKey(newPassword, salt), vaultKey) },
  };
}

// ---------- passkey (Face ID) PRF se nikla secret ----------
// PRF output ko HKDF se ek wrapping key mein badalte hain
async function prfKey(prfOutput) {
  const base = await subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('p-dock-passkey'), info: enc.encode('vault-key-wrap') }, base, 256));
}

export async function wrapForPasskey(vaultKey, prfOutput) {
  return wrapWith(await prfKey(prfOutput), vaultKey);
}

export async function unlockWithPasskey(wrapped, prfOutput) {
  try {
    return await unwrapWith(await prfKey(prfOutput), wrapped);
  } catch {
    throw new Error('Face ID se vault nahi khula');
  }
}
