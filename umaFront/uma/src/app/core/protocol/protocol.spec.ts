// @vitest-environment node
/**
 * Protocol tests -- run against REAL captured traffic.
 *
 * The fixtures in __fixtures__/golden-vectors.json are three genuine
 * request/response pairs captured from the live server
 * (https://umaserver.nanax3.xyz): tool/pre_signup, tool/start_session and
 * load/index. All three share one device id, so they decrypt with a single
 * key/IV pair.
 *
 * Why this matters: these tests do not check our code against our own
 * expectations of our own code. They check it against bytes the server
 * actually produced. If the codec is wrong, this is where it shows up --
 * offline, in milliseconds, with no network involved.
 *
 * The `@vitest-environment node` docblock at the top matters: the default
 * environment for Angular's unit-test builder is jsdom, and jsdom does NOT
 * implement SubtleCrypto (it only has crypto.getRandomValues). Node's
 * globalThis.crypto is the real WebCrypto implementation, with `subtle`.
 */

import { describe, expect, it } from 'vitest';

import goldenVectors from './__fixtures__/golden-vectors.json';
import { base64Decode, readUint32le, toHex } from './bytes';
import { HEAD, HEADER_FIXED_LEN, SID_PATTERN } from './constants';
import { decodeRequest, deriveIv, parseResponse } from './envelope';
import { nextWireSid } from './sid';

interface GoldenVector {
  endpoint: string;
  status: number;
  contentType: string;
  udidHex: string;
  requestB64: string;
  responseB64: string;
}

const vectors = goldenVectors as GoldenVector[];

function vectorFor(endpoint: string): GoldenVector {
  const found = vectors.find((v) => v.endpoint === endpoint);
  if (!found) {
    throw new Error(`missing golden vector for ${endpoint}`);
  }
  return found;
}

describe('envelope', () => {
  it('decodes every captured response', async () => {
    expect(vectors.length).toBeGreaterThan(0);

    for (const vector of vectors) {
      const envelope = await parseResponse(vector.responseB64, Uint8Array.from(
        vector.udidHex.match(/../g)!.map((byte) => parseInt(byte, 16)),
      ));

      expect(envelope.response_code, vector.endpoint).toBe(1);
      expect(envelope.data_headers.result_code, vector.endpoint).toBe(1);
      expect(envelope.data_headers.sid, vector.endpoint).toMatch(SID_PATTERN);
      expect(typeof envelope.data_headers.servertime).toBe('number');
    }
  });

  it('decodes the pre_signup country list', async () => {
    const vector = vectorFor('tool/pre_signup');
    const udid = hexToBytes(vector.udidHex);

    const envelope = await parseResponse(vector.responseB64, udid);
    const data = envelope.data as { country_list: unknown[] };

    expect(Array.isArray(data.country_list)).toBe(true);
    expect(data.country_list.length).toBe(167);
  });

  it('decodes the load/index home blob', async () => {
    const vector = vectorFor('load/index');
    const udid = hexToBytes(vector.udidHex);

    const envelope = await parseResponse(vector.responseB64, udid);
    const data = envelope.data as Record<string, unknown>;

    // The home payload is 105 keys on the live server.
    expect(Object.keys(data).length).toBe(105);

    const userInfo = data['user_info'] as { viewer_id: string };
    expect(userInfo.viewer_id).toBe('440168743960');
  });

  it('derives the IV from the first 16 hex characters of the udid', () => {
    const udid = hexToBytes('f1929d3734b39f223b398a19ef5b8fa1');

    // The IV is ASCII of the hex string, NOT the raw udid bytes.
    expect(new TextDecoder().decode(deriveIv(udid))).toBe('f1929d3734b39f22');
    expect(deriveIv(udid).length).toBe(16);
  });

  it('round-trips a captured request', async () => {
    const vector = vectorFor('load/index');
    const decoded = await decodeRequest(vector.requestB64);

    // Header layout: magic(52) + sid(16) + udid(16) + random(32) + auth
    expect(decoded.sid.length).toBe(16);
    expect(toHex(decoded.udid)).toBe(vector.udidHex);
    expect(decoded.auth.length).toBe(0);

    // The payload is the game's boilerplate plus our endpoint's fields.
    expect(decoded.payload['locale']).toBe('ENG');
    expect(typeof decoded.payload['viewer_id']).toBe('string');
    expect(decoded.payload['adid']).toBe('');
  });

  it('frames the request exactly like the server expects', () => {
    const vector = vectorFor('load/index');
    const blob = base64Decode(vector.requestB64);

    // uint32LE header length, then the header itself.
    const headerLength = readUint32le(blob, 0);
    expect(headerLength).toBe(HEADER_FIXED_LEN);
    expect(blob.subarray(4, 4 + HEAD.length)).toEqual(HEAD);
  });
});

describe('sid chain', () => {
  it('hashes the session id with the Global salt', () => {
    // Ground truth: python hashlib.md5(sid + "co!=Y;(UQCGxJ_n82").hexdigest()
    expect(
      toHex(nextWireSid('633c4e31906de52aa29784fadcc83cc8bbae6cd565')),
    ).toBe('59fc50e89d5c0b3971194f1640e9d776');

    expect(
      toHex(nextWireSid('0ac6bb569153a53f4dbf6c22bc76aa79ab16e94e6f')),
    ).toBe('35990137c0021f705aa7e4ef742e0349');
  });

  it('always produces 16 raw bytes', () => {
    const sid = nextWireSid('633c4e31906de52aa29784fadcc83cc8bbae6cd565');
    expect(sid.length).toBe(16);
  });
});

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
