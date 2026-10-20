/**
 * The session-id ("sid") chain.
 *
 * The server hands out a 42-hex session id in `data_headers.sid`: a stable
 * 32-hex base plus a 10-hex suffix that changes on every response.
 *
 * The client never sends that string back. It re-hashes it:
 *
 *   next wire sid = md5( sid_string + "co!=Y;(UQCGxJ_n82" )
 *
 * and those 16 raw bytes ride in the header's sid field. The server compares
 * them against its own md5 of the string it last issued
 * (accounts.py `_expected_wire_sid`).
 *
 * The live server currently runs with `auth_enforce: false`, so a mismatch
 * is only logged. We implement the chain anyway: it costs nothing, and it is
 * what a correct client does -- if the server ever turns enforcement on, an
 * unchained client gets SESSION_ERROR (201) on every call.
 */

import md5 from 'blueimp-md5';

import { fromHex } from './bytes';
import { SID_LEN, SID_PATTERN, SID_SALT } from './constants';

/**
 * Hash a session-id string into the 16 raw bytes that go into the header.
 *
 * `md5(string)` returns the digest as a hex string; `fromHex` turns that
 * into bytes in the right order. (Do NOT use the library's `array()` output:
 * it is a SIGNED Int32Array, so a digest byte of 0x8f comes back as -113.)
 */
export function nextWireSid(sidString: string): Uint8Array {
  const digest = fromHex(md5(sidString + SID_SALT));
  if (digest.length !== SID_LEN) {
    throw new Error(`uma: md5 digest should be ${SID_LEN} bytes`);
  }
  return digest;
}

/** Is this the expected 42-hex session-id shape? */
export function isSidShape(value: unknown): boolean {
  return typeof value === 'string' && SID_PATTERN.test(value);
}
