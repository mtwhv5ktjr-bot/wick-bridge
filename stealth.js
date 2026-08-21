// WICK BRIDGE — EIP-5564 stealth addresses (secp256k1, scheme id 1, view tags).
// Recipient privacy: a sender derives a fresh, unlinkable address only the
// recipient can spend from, and publishes an ephemeral pubkey so the recipient
// can detect it. Hides the recipient's identity at the destination; it does NOT
// hide the transfer amount or timing (see the honest note in the UI).
//
// All secp256k1 math is the audited @noble/curves (vendored). The page must
// carry the @noble/hashes import map (index.html does); this module only
// imports the curves entry relatively.
import { secp256k1 } from './vendor/@noble/curves/secp256k1.js';
import { keccak_256 } from './vendor/@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes } from './vendor/@noble/hashes/utils.js';

const P = secp256k1.ProjectivePoint;
const N = secp256k1.CURVE.n;
const toBig = b => BigInt('0x' + bytesToHex(b));
const clampScalar = s => { const m = s % N; return m === 0n ? 1n : m; };

// EVM address from a public-key point: keccak256(uncompressed[1:])[-20:]
export function addressOf(point) {
  return '0x' + bytesToHex(keccak_256(point.toRawBytes(false).slice(1)).slice(-20));
}

// The shared-secret scalar and its view tag, from a compressed ECDH point.
// viewTag = first byte of the hash BEFORE reduction (EIP-5564), so a recipient
// can reject ~255/256 of non-matching announcements before the EC add.
function sharedFromPoint(sharedPoint) {
  const h = keccak_256(sharedPoint.toRawBytes(true));
  return { scalar: clampScalar(toBig(h)), viewTag: h[0] };
}

// ---- recipient: derive keys deterministically from a wallet signature ----
// signFn(message) must return a 0x hex ECDSA signature (personal_sign). EOAs
// (MetaMask/Ledger) are deterministic (RFC-6979); smart-contract wallets are
// not — callers should verify the meta-address is stable and otherwise fall
// back to stored random keys.
export const STEALTH_KEY_MESSAGE =
  'WICK BRIDGE stealth keys\nv1\nSign to derive your private receiving keys. Do NOT sign this on any other site.';

export async function deriveKeys(signFn) {
  const sig = await signFn(STEALTH_KEY_MESSAGE);
  const entropy = keccak_256(hexToBytes(sig.replace(/^0x/, '')));
  const b = clampScalar(toBig(keccak_256(concat(entropy, [0])))); // spend
  const v = clampScalar(toBig(keccak_256(concat(entropy, [1])))); // view
  return keysFromScalars(b, v);
}

// keys from raw scalars (for imported/stored keys)
export function keysFromScalars(b, v) {
  const B = P.BASE.multiply(b), V = P.BASE.multiply(v);
  return {
    spendPriv: b, viewPriv: v,
    spendPub: B, viewPub: V,
    metaAddress: 'st:eth:0x' + bytesToHex(B.toRawBytes(true)) + bytesToHex(V.toRawBytes(true)),
  };
}

// parse a meta-address 'st:eth:0x<B33><V33>' -> { spendPub, viewPub }
export function parseMetaAddress(meta) {
  const hex = meta.trim().replace(/^st:eth:0x/i, '').replace(/^0x/, '');
  if (hex.length !== 132) throw new Error('bad meta-address length');
  return {
    spendPub: P.fromHex(hex.slice(0, 66)),
    viewPub: P.fromHex(hex.slice(66)),
  };
}

// ---- sender: compute a stealth address to pay ----
// Returns the address to use as the bridge `to`, plus the announcement fields.
export function computeStealth(meta, ephemeralPrivHex) {
  const { spendPub, viewPub } = typeof meta === 'string' ? parseMetaAddress(meta) : meta;
  const r = ephemeralPrivHex ? BigInt('0x' + ephemeralPrivHex.replace(/^0x/, '')) : clampScalar(toBig(secp256k1.utils.randomPrivateKey()));
  const R = P.BASE.multiply(r);                 // ephemeral pubkey, published
  const { scalar: s, viewTag } = sharedFromPoint(viewPub.multiply(r)); // r·V
  const stealth = spendPub.add(P.BASE.multiply(s));
  return {
    stealthAddress: addressOf(stealth),
    ephemeralPubKey: '0x' + bytesToHex(R.toRawBytes(true)), // 33-byte compressed
    viewTag,                                                // single byte
  };
}

// ---- recipient: scan an announcement ----
// Fast path: if the view tag doesn't match, it's not ours (cheap). On a tag
// hit, returns the stealth address; caller confirms it equals the announced one.
export function checkAnnouncement(keys, ephemeralPubKey, viewTag) {
  const R = P.fromHex(ephemeralPubKey.replace(/^0x/, ''));
  const { scalar: s, viewTag: tag } = sharedFromPoint(R.multiply(keys.viewPriv)); // v·R
  if (viewTag !== undefined && viewTag !== null && Number(viewTag) !== tag) return null;
  const stealth = keys.spendPub.add(P.BASE.multiply(s));
  return { stealthAddress: addressOf(stealth), sharedScalar: s };
}

// recover the private key that controls a matched stealth address
export function stealthPrivateKey(keys, ephemeralPubKey) {
  const R = P.fromHex(ephemeralPubKey.replace(/^0x/, ''));
  const { scalar: s } = sharedFromPoint(R.multiply(keys.viewPriv));
  const p = (keys.spendPriv + s) % N;
  return '0x' + p.toString(16).padStart(64, '0');
}

function concat(a, b) { const out = new Uint8Array(a.length + b.length); out.set(a, 0); out.set(b, a.length); return out; }
