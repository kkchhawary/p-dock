// Face ID / Touch ID: WebAuthn passkey + PRF extension.
// PRF ek secret deta hai jo sirf tab milta hai jab aap Face ID/Touch ID se verify karo.
// Usi secret se vault ki chaabi khulti hai — yeh sirf "darwaza" nahi, asli taala hai.
const subtle = globalThis.crypto.subtle;
let saltPromise = null;
const prfSalt = () => (saltPromise ||= subtle.digest('SHA-256', new TextEncoder().encode('p-dock-prf-v1')).then((b) => new Uint8Array(b)));

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

export async function passkeySupported() {
  try {
    return Boolean(window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()));
  } catch {
    return false;
  }
}

async function getPrf(allowIds) {
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: rand(32),
      rpId: location.hostname,
      allowCredentials: allowIds.map((id) => ({ type: 'public-key', id: fromB64u(id) })),
      userVerification: 'required',
      timeout: 60000,
      extensions: { prf: { eval: { first: await prfSalt() } } },
    },
  });
  const out = cred.getClientExtensionResults().prf?.results?.first;
  if (!out) throw new Error('Is browser mein Face ID se vault kholna support nahi hai');
  return { id: cred.id, prfOutput: new Uint8Array(out) };
}

// Naya Face ID jodna → { id, prfOutput }
export async function register(ownerName) {
  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'P-Dock', id: location.hostname },
      user: { id: rand(16), name: ownerName || 'P-Dock', displayName: ownerName || 'P-Dock' },
      challenge: rand(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      timeout: 60000,
      extensions: { prf: { eval: { first: await prfSalt() } } },
    },
  });
  const prf = cred.getClientExtensionResults().prf;
  if (!prf?.enabled && !prf?.results) throw new Error('Is browser/device mein Face ID se vault kholna support nahi hai (iOS 18 / macOS 15 ya naya chahiye)');
  if (prf.results?.first) return { id: cred.id, prfOutput: new Uint8Array(prf.results.first) };
  // Kuch devices create ke waqt secret nahi dete — ek baar aur Face ID
  return getPrf([cred.id]);
}

// Lock screen se kholna → { id, prfOutput }
export const authenticate = (ids) => getPrf(ids);

export const _test = { b64u, fromB64u };
