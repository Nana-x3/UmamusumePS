/**
 * Wire-protocol constants for the Global (English) UmaPS server.
 *
 * Every value here has a counterpart in the Python server implementation,
 * which is the ground truth for this protocol:
 *
 *   umaBack/server/app/crypto.py      -- the framing, the magic header
 *   umaBack/server/app/accounts.py    -- the session-id ("sid") chain
 *
 * The protocol is deliberately "secretless": the AES key travels with every
 * message (appended in the clear) and the IV is derived from a random device
 * id that the server reads straight out of the request header. There is no
 * shared secret to steal -- it is a puzzle-box format, not a security system.
 */

import { fromHex } from './bytes';

/**
 * The 52-byte magic header every request starts with. If these bytes do not
 * match, the server raises "request header does not start with the expected
 * magic" and the request is rejected.
 *
 * Stored as hex because 52 raw bytes are unreadable in a diff.
 */
export const HEAD_HEX =
  '6b20e2ab6c311330f761d737ce3f3025750850665eea58b6372f8d2f57501eb' +
  '344bdb7270a9067f5b63cd61f152cfb986cbfbf7a';

/** The same magic, as bytes. */
export const HEAD = fromHex(HEAD_HEX);

/** Length of the raw session id that rides in the header (16 bytes, not hex). */
export const SID_LEN = 16;

/** Length of the raw device id (udid) that rides in the header. */
export const UDID_LEN = 16;

/** Length of the per-request random filler that follows the udid. */
export const RANDOM_LEN = 32;

/** Length of the AES-256 key (generated per message, appended in the clear). */
export const KEY_LEN = 32;

/** AES block size == IV length. */
export const IV_LEN = 16;

/**
 * Length of the fixed part of the header: magic + sid + udid + random.
 * Anything after this is the variable-length `auth` field.
 */
export const HEADER_FIXED_LEN = HEAD.length + SID_LEN + UDID_LEN + RANDOM_LEN;

/**
 * The salt the real Global client mixes into the session-id chain.
 * Source: accounts.py `_SID_SALTS["global"]`.
 */
export const SID_SALT = 'co!=Y;(UQCGxJ_n82';

/**
 * The JP client's salt. Recorded for completeness -- the live server we talk
 * to is the Global transport, so this one is never used.
 */
export const SID_SALT_JP = 'r!I@mt8e5i=';

/**
 * The locale tag the Global (English) client sends on every request.
 * Captured traffic from a JP client used "JPN"; the Global build uses "ENG".
 */
export const GLOBAL_LOCALE = 'ENG';

/**
 * The shape of a session id as it appears in `data_headers.sid`: a 32-hex
 * stable base plus a 10-hex suffix that changes on every response.
 */
export const SID_PATTERN = /^[0-9a-f]{42}$/;
