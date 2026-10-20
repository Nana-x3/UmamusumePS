/**
 * The request/response envelope -- the actual wire format.
 *
 * Ported line by line from umaBack/server/app/crypto.py.
 *
 * REQUEST (browser -> server), POST body is base64 ASCII text:
 *
 *   base64( uint32LE(len(header)) + header + body )
 *
 *   header = HEAD(52) + sid(16) + udid(16) + random(32) + auth(variable)
 *   body   = AES-256-CBC(key, iv)( uint32LE(len(msgpack)) + msgpack ) + key(32)
 *   iv     = first 16 HEX CHARACTERS of the udid, as ASCII bytes
 *
 * RESPONSE (server -> browser), HTTP body is base64 ASCII text:
 *
 *   base64( ciphertext + key )        <- note: no header, and the key is the
 *                                        LAST 32 bytes of the body.
 *
 * Two length prefixes, in two different places -- this is the part that is
 * easy to get wrong:
 *
 *   - the HEADER length prefix is OUTSIDE the encryption
 *   - the PAYLOAD length prefix is INSIDE the encryption
 */

import { aesCbcDecrypt, aesCbcEncrypt, importAesKey } from './aes';
import {
  base64Decode,
  base64Encode,
  concatBytes,
  readUint32le,
  randomBytes,
  toHex,
  uint32le,
  asciiBytes,
} from './bytes';
import { HEAD, HEADER_FIXED_LEN, IV_LEN, KEY_LEN } from './constants';
import { decodeMsgpack, encodeMsgpack } from './msgpack';

/** The `data_headers` block every response carries. */
export interface UmaDataHeaders {
  /** 1 = success. Anything else is a business-logic error code. */
  result_code: number;
  /** The 42-hex session id. The client must re-hash this for the next call. */
  sid: string;
  /** Echo of the account the request was made for. */
  viewer_id: string;
  /** Server clock (unix seconds). */
  servertime: number;
  /** Badge flags etc. (e.g. unread_information_exists). */
  notifications?: Record<string, unknown>;
  /** CDN base URLs, returned by tool/start_session. */
  server_list?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * The full response envelope.
 *
 * IMPORTANT: `response_code` stays 1 even for errors. The real error code
 * lives in `data_headers.result_code` (205 = PARAM_ERROR is the default
 * failure), and `data` is `{}` when a request fails.
 */
export interface UmaEnvelope<T = Record<string, unknown>> {
  response_code: number;
  data_headers: UmaDataHeaders;
  data: T;
}

/**
 * Derive the AES IV from the device id.
 *
 * The server does `udid_raw.hex()[:16].encode()` -- that is, the first 16
 * CHARACTERS of the udid's hex representation, taken as ASCII bytes. Not the
 * raw udid bytes, and not a hash of them.
 */
export function deriveIv(udid: Uint8Array): Uint8Array {
  return asciiBytes(toHex(udid).slice(0, IV_LEN));
}

/** Everything needed to build one request frame. */
export interface BuildRequestArgs {
  /** The 16-byte device id (persisted in localStorage across sessions). */
  udid: Uint8Array;
  /** The 16-byte session id for THIS request (see sid.ts). */
  sid: Uint8Array;
  /** The payload to pack. */
  payload: Record<string, unknown>;
  /** Optional trailing header field. The Global server ignores it. */
  auth?: Uint8Array;
}

/**
 * Build a request frame and return it base64-encoded (ready to POST).
 *
 * The AES key is generated fresh for every message and appended to the
 * ciphertext in the clear. That is what makes the scheme self-decrypting:
 * the server derives the IV from the udid it just read out of the header,
 * and finds the key at the very end of the body.
 */
export async function buildRequest({
  udid,
  sid,
  payload,
  auth,
}: BuildRequestArgs): Promise<string> {
  const iv = deriveIv(udid);

  // 1. pack the payload, prefixed with its own length (INSIDE the cipher)
  const packed = encodeMsgpack(payload);
  const plaintext = concatBytes(uint32le(packed.length), packed);

  // 2. encrypt with a per-message key
  const key = randomBytes(KEY_LEN);
  const ciphertext = await aesCbcEncrypt(await importAesKey(key), iv, plaintext);

  // 3. assemble the header: magic + session id + device id + random filler
  const header = concatBytes(
    HEAD,
    sid,
    udid,
    randomBytes(32),
    auth ?? new Uint8Array(0),
  );

  // 4. frame it: header length (OUTSIDE the cipher) + header + body
  const frame = concatBytes(uint32le(header.length), header, ciphertext, key);

  return base64Encode(frame);
}

/**
 * Decode a response body back into an envelope.
 *
 * The response has no header: it is just base64(ciphertext + key), with the
 * key as the last 32 bytes. The IV is derived from the same udid that was
 * used for the request.
 */
export async function parseResponse<T = Record<string, unknown>>(
  responseB64: string,
  udid: Uint8Array,
): Promise<UmaEnvelope<T>> {
  const raw = base64Decode(responseB64.trim());

  if (raw.length <= KEY_LEN) {
    throw new Error(
      `uma: response too short to contain a key (${raw.length} bytes)`,
    );
  }

  // The key is appended in the clear, at the end.
  const key = raw.subarray(raw.length - KEY_LEN);
  const ciphertext = raw.subarray(0, raw.length - KEY_LEN);

  const plaintext = await aesCbcDecrypt(
    await importAesKey(key),
    deriveIv(udid),
    ciphertext,
  );

  // The payload length prefix lives inside the decrypted plaintext.
  const length = readUint32le(plaintext, 0);
  const packed = plaintext.subarray(4, 4 + length);

  return decodeMsgpack(packed) as UmaEnvelope<T>;
}

/**
 * Decode a REQUEST frame. The mirror image of `buildRequest`, and only used
 * by the tests -- it lets us verify our understanding of the format against
 * real captured traffic instead of against ourselves.
 */
export async function decodeRequest(requestB64: string): Promise<{
  payload: Record<string, unknown>;
  sid: Uint8Array;
  udid: Uint8Array;
  auth: Uint8Array;
}> {
  const blob = base64Decode(requestB64.trim());

  const headerLength = readUint32le(blob, 0);
  const header = blob.subarray(4, 4 + headerLength);
  const body = blob.subarray(4 + headerLength);

  const sid = header.subarray(52, 52 + 16);
  const udid = header.subarray(52 + 16, 52 + 16 + 16);
  const auth = header.subarray(HEADER_FIXED_LEN);

  const key = body.subarray(body.length - KEY_LEN);
  const ciphertext = body.subarray(0, body.length - KEY_LEN);

  const plaintext = await aesCbcDecrypt(
    await importAesKey(key),
    deriveIv(udid),
    ciphertext,
  );

  const length = readUint32le(plaintext, 0);
  const packed = plaintext.subarray(4, 4 + length);

  return {
    payload: decodeMsgpack(packed) as Record<string, unknown>,
    sid,
    udid,
    auth,
  };
}
