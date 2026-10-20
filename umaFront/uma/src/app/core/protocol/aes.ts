/**
 * AES-256-CBC via the WebCrypto API.
 *
 * The single most important fact about this file: WebCrypto's AES-CBC
 * implementation applies PKCS#7 padding on encrypt AND removes it on
 * decrypt. The Python server does that by hand (`pad(...)` / `unpad(...)`),
 * so the temptation to port those two lines over is strong -- but doing so
 * here would double-pad on the way out and fail to unpad on the way in.
 *
 * Decryption also throws an OperationError when the padding is invalid,
 * which is a useful signal that a frame was built wrong.
 */

/** Import raw key material as an AES-CBC CryptoKey. */
export async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    'raw',
    raw as BufferSource,
    { name: 'AES-CBC' },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt with AES-256-CBC. Padding is added by WebCrypto.
 */
export async function aesCbcEncrypt(
  key: CryptoKey,
  iv: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const encrypted = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: iv as BufferSource },
    key,
    plaintext as BufferSource,
  );
  return new Uint8Array(encrypted);
}

/**
 * Decrypt with AES-256-CBC. Padding is removed by WebCrypto.
 */
export async function aesCbcDecrypt(
  key: CryptoKey,
  iv: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const decrypted = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: iv as BufferSource },
    key,
    ciphertext as BufferSource,
  );
  return new Uint8Array(decrypted);
}
