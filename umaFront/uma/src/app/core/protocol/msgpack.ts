/**
 * MessagePack codec.
 *
 * The game server packs its payloads with `msgpack.packb` (Python). The
 * wire format is a compact binary encoding of the same shapes JSON would
 * carry -- maps, arrays, strings, integers, bytes.
 *
 * Why a wrapper instead of importing the library everywhere: it keeps the
 * dependency in exactly one place, so swapping the implementation (or
 * switching on the records/extension modes) later touches one file.
 *
 * NOTE: do not hand-roll this. A hand-written encoder is exactly where a
 * one-byte/three-byte fixmap header bug hides, and such a bug only shows up
 * as an unexplainable decode failure much later.
 */

import { decode, encode } from '@msgpack/msgpack';

/** Pack a value into MessagePack bytes. */
export function encodeMsgpack(value: unknown): Uint8Array {
  return encode(value);
}

/**
 * Unpack MessagePack bytes.
 *
 * Defaults: maps become plain objects, binary becomes Uint8Array -- both of
 * which are what the rest of the app wants.
 */
export function decodeMsgpack(bytes: Uint8Array): unknown {
  return decode(bytes);
}
