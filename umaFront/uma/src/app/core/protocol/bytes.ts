/**
 * Small byte helpers so the rest of the protocol code reads like the Python
 * it was ported from (struct.unpack / binascii / base64).
 *
 * This module has no dependencies -- it is the bottom of the stack.
 */

/** Hex-encode bytes ("0a1b..."). */
export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

/** Decode a hex string into bytes. */
export function fromHex(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : hex.slice(0, -1);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Join byte arrays into one. */
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Encode a 32-bit unsigned integer, little-endian.
 *
 * The server reads these with `struct.unpack("<I", ...)` -- little-endian is
 * not a detail you can skip. Getting it backwards still produces a
 * well-formed-looking frame that simply cannot be decoded.
 */
export function uint32le(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, true);
  return out;
}

/** Read a little-endian 32-bit unsigned integer. */
export function readUint32le(bytes: Uint8Array, offset = 0): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(offset, true);
}

/**
 * Base64-encode bytes.
 *
 * `btoa` only accepts "binary strings" (one char per byte, 0-255), so the
 * bytes are converted first. The conversion is chunked: spreading a 45 KB
 * buffer into `String.fromCharCode(...)` in one go exceeds the argument
 * limit of the function and throws.
 */
export function base64Encode(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Decode a base64 string into bytes. */
export function base64Decode(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/** UTF-8/ASCII encode a string. */
export function asciiBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Cryptographically secure random bytes. */
export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** Constant-time-ish comparison helper (not security-critical here). */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
