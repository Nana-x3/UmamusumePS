import { buildRequest, parseResponse } from './envelope';
import type { UmaEnvelope } from './envelope';
import { nextWireSid } from './sid';
import { fromHex, randomBytes, toHex } from './bytes';
import { GLOBAL_LOCALE, SID_LEN, UDID_LEN } from './constants';


export class UmaError extends Error {
  constructor(
    readonly resultCode: number,
    readonly endpoint: string,
    readonly sid: string | null,
  ) {
    super(`uma: ${endpoint} failed with result_code ${resultCode}`);
    this.name = 'UmaError';
  }

  /** True for 201 SESSION_ERROR -- the session is stale, re-login may help. */
  get isSessionError(): boolean {
    return this.resultCode === 201;
  }
}

const RESULT_CODE_NAMES: Record<number, string> = {
  1: 'OK',
  101: 'MAINTENANCE',
  102: 'SERVER_ERROR',
  201: 'SESSION_ERROR',
  202: 'AUTH_ERROR',
  205: 'PARAM_ERROR',
};

export interface UmaClientOptions {
  /** Where the relay lives. Default: the same origin, under /g. */
  baseUrl?: string;
  /** Where to persist the session identity. Pass null to disable. */
  storage?: Storage | null;
  /** Injectable fetch -- the tests use this to avoid the network. */
  fetchImpl?: typeof fetch;
  /**
   * Called when the server answers 201 SESSION_ERROR. Wire this to the
   * session store in a later chunk so the client can re-login by itself.
   */
  onSessionError?: () => Promise<void>;
}

export function resultCodeName(code: number): string {
  return RESULT_CODE_NAMES[code] ?? `UNKNOWN(${code})`;
}

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const UMA_UDID_KEY = 'uma.udid';
const UMA_VIEWER_ID_KEY = 'uma.viewer_id';
const UMA_DEVICE_ID_KEY = 'uma.device_id';



export class UmaClient {
  private readonly baseUrl: string;
  private readonly storage: Storage | null;
  private readonly fetchImpl: typeof fetch;
  private readonly onSessionError?: () => Promise<void>;

  /** The 16-byte device id. Stable forever -- the IV is derived from it. */
  private readonly udid: Uint8Array;

  /** A stable per-browser id, sent in the boilerplate payload. */
  private readonly deviceId: string;

  /** Which account we're calling for. Empty string = not signed in. */
  private viewerId = '';

  /** The 42-hex session id from the last response. Memory only. */
  private lastSid: string | null = null;

  /**
   * The call queue. Every request waits for the previous one to finish.
   */
  private tail: Promise<unknown> = Promise.resolve();

  constructor(options: UmaClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? '/g';
    this.storage =
      options.storage === undefined ? safeStorage() : options.storage;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.onSessionError = options.onSessionError;

    this.udid = this.loadOrCreateUdid();
    this.deviceId = this.loadOrCreateDeviceId();
    this.viewerId = this.storage?.getItem(UMA_VIEWER_ID_KEY) ?? '';
  }

  // --- public API ---------------------------------------------------------

  /**
   * Call an endpoint and return the decoded envelope.
   *
   * Throws UmaError when the server answers with result_code != 1.
   */
  call<T = Record<string, unknown>>(
    endpoint: string,
    body: Record<string, unknown> = {},
  ): Promise<UmaEnvelope<T>> {
    // Queue the call behind whatever is already running.
    const run = this.tail.then(() => this.doCall<T>(endpoint, body, false));

    // Keep the queue alive even if this call rejects. Without this catch,
    // one failed call poisons every future call.
    this.tail = run.catch(() => undefined);

    return run;
  }

  /** The account id we're calling for ('' when signed out). */
  getViewerId(): string {
    return this.viewerId;
  }

  /** Set (and persist) the account id. Called after a successful signup. */
  setViewerId(viewerId: string): void {
    this.viewerId = viewerId;
    this.storage?.setItem(UMA_VIEWER_ID_KEY, viewerId);
  }

  /** The device id in hex -- handy for debugging. */
  getUdidHex(): string {
    return toHex(this.udid);
  }

  /** The session id from the last response, if any. */
  getLastSid(): string | null {
    return this.lastSid;
  }

  // --- internals ----------------------------------------------------------



  private async doCall<T>(
    endpoint: string,
    body: Record<string, unknown>,
    isRetry: boolean,
  ): Promise<UmaEnvelope<T>> {
    // 1. Assemble the payload: identity, then boilerplate, then the
    //    endpoint's own fields (which win on conflict).
    const payload: Record<string, unknown> = {
      viewer_id: this.viewerId,
      ...this.boilerplate(),
      ...body,
    };

    // 2. The header session id: hash the last one we were given.
    const sid = this.lastSid
      ? nextWireSid(this.lastSid)
      : randomBytes(SID_LEN);

    // 3. Encode it.
    const encoded = await buildRequest({
      udid: this.udid,
      sid,
      payload,
    });

    // 4. Send it to the relay.
    const response = await this.fetchImpl(`${this.baseUrl}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-msgpack; charset=utf-8' },
      body: encoded,
    });

    if (!response.ok) {
      throw new Error(`uma: ${endpoint} -> HTTP ${response.status}`);
    }

    // 5. Decode the answer.
    const envelope = await parseResponse<T>(await response.text(), this.udid);

    // 6. Remember the new session id -- the server rotates it on EVERY
    //    response, including failures.
    const newSid = envelope.data_headers?.sid ?? null;
    if (newSid) {
      this.lastSid = newSid;
    }

    // 7. The error check. `response_code` is always 1 -- the real code is
    //    `data_headers.result_code`.
    const resultCode = envelope.data_headers?.result_code ?? 1;
    if (resultCode !== 1) {
      // A stale session: re-login once and try again.
      if (resultCode === 201 && this.onSessionError && !isRetry) {
        await this.onSessionError();
        return this.doCall<T>(endpoint, body, true);
      }
      throw new UmaError(resultCode, endpoint, newSid);
    }

    return envelope;
  }

  /**
   * The payload fields every request carries.
   * (Copied from a real captured request -- see __fixtures__/golden-vectors.json)
   */
  private boilerplate(): Record<string, unknown> {
    return {
      device: 4,
      device_id: this.deviceId,
      device_name: 'web',
      graphics_device_name: 'web',
      ip_address: '10.0.0.1',
      platform_os_version: 'Windows 11  (10.0.26200) 64bit',
      carrier: '',
      keychain: 0,
      locale: GLOBAL_LOCALE,
      button_info: '',
      dmm_viewer_id: null,
      dmm_onetime_token: null,
      steam_id: null,
      steam_session_ticket: null,
    };
  }

  /** Read the stored device id, or create (and store) a new one. */
  private loadOrCreateUdid(): Uint8Array {
    const stored = this.storage?.getItem(UMA_UDID_KEY);
    if (stored) {
      return fromHex(stored);
    }
    const fresh = randomBytes(UDID_LEN);
    this.storage?.setItem(UMA_UDID_KEY, toHex(fresh));
    return fresh;
  }

  /** Read the stored device id string, or create (and store) a new one. */
  private loadOrCreateDeviceId(): string {
    const stored = this.storage?.getItem(UMA_DEVICE_ID_KEY);
    if (stored) {
      return stored;
    }
    const fresh = toHex(randomBytes(8));
    this.storage?.setItem(UMA_DEVICE_ID_KEY, fresh);
    return fresh;
  }
}


