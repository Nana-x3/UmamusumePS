# Phase 0 — Status & Handoff

**Project:** Umamusume browser client (Angular 22) talking to the live Global UmaPS server
**Repo:** `/root/projects/umaServer/UmamusumePS` · **App:** `umaFront/uma`
**Game server (black box — never modify):** `https://umaserver.nanax3.xyz`
**Last updated:** 2026-11-01 · companion to `browser-client-architecture.md` + `browser-client-phasing.md`

---

## 0. Phase 0 at a glance

> **Milestone:** *"logged into the live server from a browser; home shell shows real viewer id, wallet and user info."*

The **browser ⇄ live-server loop is working end to end.** A browser can mint or enter a
viewer id, complete `tool/start_session`, pull the 105-key `load/index` blob, keep the
session across a reload, and sign out. Everything below was exercised against the live
server (not fixtures) during this phase.

| | |
|---|---|
| **Green** | `tsc -p tsconfig.app.json --noEmit` · login / **signup** / resume / sign-out against the live server · `load/index` returns 105 keys + `single_mode_scenario_id_array = [1,2,3,4]` |
| **Amber** | `tsc -p tsconfig.spec.json --noEmit` fails on the leftover `node:fs` import (§8.1) · home template renders wallet only (§8.3) · no error UI (§8.4) |
| **Not run here** | `npm test`, `npm run build` — container has Node **v20.19.2**; Angular 22 needs ≥ **v22.22.3** (§4) |

### Acceptance checklist

| # | Criterion | Status | Notes |
|---|---|---|---|
| 1 | clear localStorage → create account → home shows name, wallet, scenarios | ⚠️ partial | **signup race fixed** — `signUpAndStart()` awaits `signUp()` before `startSession()`, so a fresh account lands on `status: 'ready'` (§8.2). Only the home template is thin: it shows wallet only (§8.3) |
| 2 | reload → auto-resume, no re-login | ✅ | `SignInComponent.ngOnInit()` → `SessionStore.resume()` → `api.client.getViewerId()` (from `localStorage['uma.viewer_id']`) → fresh `start_session` |
| 3 | sign out → sign back in with the same id | ✅ | `signOut()` clears id/status/state; `startSession()` now pushes the typed id into `UmaClient` before the first call |
| 4 | `npm run build` → same through the prod relay | ⚠️ unverified | relay is implemented in `src/server.ts`; the build could not run on Node 20 |

---

## 1. Implementation log — what was built

### Protocol / transport (already in place, unchanged)

- `core/protocol/` — msgpack, WebCrypto AES-256-CBC, `HEAD` magic, u32LE framing,
  udid persistence, md5 sid chaining, base64 in/out.
- `uma-client.ts` — one queued `call(endpoint, body)` → decoded `UmaEnvelope<T>`,
  boilerplate payload, sid rotation, `result_code` error mapping, and a
  `onSessionError` retry hook on `201 SESSION_ERROR` (hook exists but is not wired yet).
- Dev proxy (`proxy.conf.mjs`, `/g/*`) and prod relay (`src/server.ts`).

### Session layer — `core/state/session.store.ts`

| Member | Purpose |
|---|---|
| `status` | `'idle' \| 'connecting' \| 'ready' \| 'error'` |
| `viewerid` | the account id shown/edited in the UI |
| `userInfo` | full `load/index` → `user_info` |
| `wallet` | `{ coin, fcoin }` from `coin_info` |
| `tp_info` / `rp_info` | `{ current_*, max_*, max_recovery_time }` |
| `scenarioIds` | `single_mode_scenario_id_array` (`[1,2,3,4]`) |
| `countries` | `pre_signup` → `country_list` (167 entries) |
| `resume()` | read the stored id → `startSession()`, returns `false` when nothing is stored |
| `getCountryList()` | `tool/pre_signup` |
| `signUp(country)` | `tool/signup` → stores the minted viewer id |
| `signUpAndStart(country)` | `await signUp()` **then** `await startSession()` — the only signup path the UI uses |
| `startSession()` | `setViewerId` → `tool/start_session` → `load/index` → fill state, status `ready`; throws on an empty viewer id |
| `changeName(name)` | `user/change_name` (trim, 1–16 chars, requires `ready`) |
| `changeSex(1 \| 2)` | `user/change_sex` (requires `ready`) |
| `signOut()` | clears the stored id + sid, resets status and every account field |

### Programmatic API layer — `core/api/`

| Function | Endpoint |
|---|---|
| `preSignup(client)` | `tool/pre_signup` |
| `signup(client, params)` | `tool/signup` (+ `client.setViewerId(minted_id)`) |
| `startSession(client)` | `tool/start_session` |
| `loadIndex(client)` | `load/index` |
| `readInfoIndex(client)` | `read_info/index` (wrapper exists, not wired into the UI yet) |
| `changeName(client, name)` | `user/change_name` |
| `changeSex(client, sex)` | `user/change_sex` |

`ApiClient` is the only consumer of `UmaClient`; `SessionStore` is the only consumer of
`ApiClient`. One `UmaClient` for the whole app (it owns udid + sid + the call queue).

### UI

- `components/signIn.component/` — login form (viewer id), country-picker signup,
  post-signup name/sex editor, resume on init, "Enter Game".
- `components/home.component/` — home shell (wallet cards today).
- `app.ts` / `app.html` — sign-out button.
- `app.routes.ts` — `''` → sign-in, `/home` → home, `/check` → protocol debug screen.

### Client identity plumbing — `core/protocol/uma-client.ts`

```ts
getViewerId(): string            // '' when signed out
setViewerId(id: string): void    // persists to localStorage, clears lastSid
getLastSid(): string | null      // 42-hex, memory only
```

`setViewerId('')` now **removes** `uma.viewer_id` (instead of writing `""`) and always
drops `lastSid`, so a new account never inherits the previous account's session.

---

## 2. File map

```
umaFront/uma/
├── proxy.conf.mjs                  dev proxy: /g/* → https://umaserver.nanax3.xyz
├── tools/check-client.ts           terminal e2e against the live server
├── src/server.ts                   prod relay (Express 5) — stateless byte pipe
├── src/types/blueimp-md5.d.ts      ambient types
└── src/app/
    ├── app.ts / app.html           shell + sign-out
    ├── app.routes.ts               '', 'home', 'check'
    ├── components/
    │   ├── signIn.component/       login / signup / resume
    │   └── home.component/         home shell
    ├── core/
    │   ├── protocol/               wire codec (no Angular deps)
    │   │   ├── uma-client.ts       call(), sid chain, viewer id persistence
    │   │   ├── envelope.ts         request/response framing
    │   │   └── __fixtures__/       real captures for offline tests
    │   ├── api/                    typed endpoint wrappers (pure functions)
    │   ├── accounts/account-id.ts  newViewerId(), isValidViewerId()
    │   └── state/session.store.ts  the single source of truth
    └── testStuff/protocol-check.component.ts   /check debug screen
```

---

## 3. Session lifecycle (how it actually behaves)

```
                    ┌──────────────┐
 app boot ─────────►│  /  (sign-in)│
                    └──────┬───────┘
                           │ ngOnInit → resume()
              ┌────────────┴────────────┐
   stored id? │                         │ no stored id
              ▼                         ▼
   startSession(id)               show login form
   status=connecting                     │
   tool/start_session                    ├─ type id ──► startSession(id)
   load/index                            │
   status=ready                          └─ Sign Up ──► pre_signup → signup → startSession
              │                                            (one awaited signUpAndStart() — §8.2)
              ▼
        "Enter Game" → /home
              │
              ▼
        signOut() → clear id + sid + state, status=idle → /
```

**localStorage keys** (all three survive reload; only `viewer_id` is a credential):

| Key | Set by | Meaning |
|---|---|---|
| `uma.udid` | `UmaClient.loadOrCreateUdid()` | 16 random bytes, derives the AES IV |
| `uma.device_id` | `UmaClient.loadOrCreateDeviceId()` | stable per-browser id in the payload |
| `uma.viewer_id` | `UmaClient.setViewerId()` | the 12-digit account id |

The **sid is memory only** and re-derived on every request:
`next_header_sid = md5(last_sid_string + "co!=Y;(UQCGxJ_n82")` (16 raw bytes).
A reload therefore has the credential but not the session — hence `resume()`.

---

## 4. Verification commands

```bash
cd /root/projects/umaServer/UmamusumePS/umaFront/uma

npx tsc -p tsconfig.app.json --noEmit       # ✅ passes here
npx tsc -p tsconfig.spec.json --noEmit      # ⚠️ fails on node:fs — see §8.1

npm test                                    # requires Node ≥ 22.22.3
npm run check:client                        # terminal e2e: UmaClient → relay → live server
npm start                                   # dev  → http://localhost:4200
npm run build && npm run serve:ssr:uma      # prod → http://localhost:4000
```

> **Container:** `localhost` works *inside* the container; from another machine use the
> container IP (`hostname -i` — it can change on recreate).
>
> **Node gate:** `ng test` and `ng build` refuse to start on Node v20:
> *"The Angular CLI requires a minimum Node.js version of v22.22.3 or v24.15.0 or v26.0.0."*

---

## 5. The wire protocol (settled — don't redesign)

```
request  = base64( u32LE(len(header)) + header + body )
header   = HEAD(52) + sid(16) + udid(16) + random(32) + auth(var)
body     = AES-256-CBC(key, iv)( u32LE(len(msgpack)) + msgpack ) + key(32, in the clear)
iv       = ascii( hex(udid)[0:16] )
response = base64( ciphertext + key )            // key = LAST 32 bytes
envelope = { response_code:1, data_headers:{ result_code, sid, viewer_id, servertime, … }, data:{…} }
```

Hard-won rules — each one cost a debugging session:

1. **The real error is `data_headers.result_code`, never `response_code`** (that stays `1` even on failure). `205` = PARAM_ERROR, `201` = SESSION_ERROR.
2. **WebCrypto AES-CBC pads and unpads PKCS#7 itself** — do not pad/unpad by hand.
3. **IV = ASCII of the first 16 hex chars of the udid**, not the raw bytes.
4. **The response key is the LAST 32 bytes** of the base64-decoded body.
5. **The header length prefix is OUTSIDE the cipher; the payload length prefix is INSIDE it.**
6. **The sid chain:** the next request's header sid = `md5(last_sid_string + "co!=Y;(UQCGxJ_n82")` (16 raw bytes). The server's sid is a stable 32-hex base + a rotating 10-hex suffix.
7. **`viewer_id` must be a 12-digit NUMERIC string.** Empty or non-numeric → `start_session` can still answer `200`, then `load/index` returns **HTTP 500** (the server does `int(viewer_id)` in `handlers/circles.py:278`). *This exact failure was hit during P0 and fixed by calling `setViewerId()` before `start_session`.*
8. **Payload boilerplate** (from a real capture): `viewer_id, device:4, device_id, device_name, graphics_device_name, ip_address, platform_os_version, carrier, keychain, locale:"ENG", button_info, dmm_viewer_id, dmm_onetime_token, steam_id, steam_session_ticket` (+ `adid` for load/index, `attestation_type`/`device_token` for start_session).

---

## 6. The server's identity model (verified against the source)

- Identity = **the `viewer_id` string in the payload. Nothing else.**
- `accounts.sqlite3`: `viewer_id` PK + `auth_key, sid, created_at, last_seen, transition_password, pending_deletion_at, udid`.
- `state.sqlite3`: `viewer_state_kv (viewer_id, key, value)` — the entire game state is rows keyed by viewer_id.
- `udid` → only derives the IV (Global). `sid` → only enforced when `auth_enforce` is on (**it is false**). `auth_key` → stored but **never validated** on Global. `steam_id` / `device_id` → echoed back, never used for lookup.
- **An unknown viewer_id is silently created** (`accounts.touch()` upserts; `load/index` seeds the blob) — no error, so a typo looks like "the game wiped my account".
- `tool/signup` **always** mints a new account; it never returns an existing one. Returning players call `tool/start_session` with their stored id. **The server never decides new-vs-returning — the client does.**
- **`tool/signup` is not strictly needed.** An implicit account works fine (verified: `790657293395` → 105-key home blob, `name: "Trainer3395"`).
- A fresh account's `user_info.name` is auto-derived as `Trainer` + the last 4 digits of the id (`load.py` `_neutralize_identity`); `user/change_name` exists to set a real name.

---

## 7. Phase 0 API reference

All calls go through `UmaClient.call(endpoint, body)`, which merges the boilerplate
(§5 rule 8) **first** and the endpoint body **last** (endpoint fields win on conflict).
Every call is queued — no two requests overlap.

### 7.0 The response envelope

```ts
interface UmaEnvelope<T> {
  response_code: number;            // always 1 — NOT the error code
  data_headers: {
    result_code: number;            // 1 = success, anything else = error
    sid: string;                    // 42-hex, rotate into the next request
    viewer_id: string;
    servertime: number;             // unix seconds
    notifications?: Record<string, unknown>;
    server_list?: Record<string, string>;  // only on tool/start_session
    [key: string]: unknown;
  };
  data: T;                          // {} when result_code != 1
}
```

Real `data_headers` from `load/index` (test account `440168743960`):

```json
{
  "viewer_id": "440168743960",
  "sid": "<42 hex>",
  "servertime": 1784317775,
  "result_code": 1,
  "notifications": {
    "training_challenge_mission": [{ "mission_id": 2200068, "exec_count": 1, "mission_status": 1 }],
    "add_present_num": 44,
    "unread_information_exists": 1,
    "room_match_race_result_num": 0
  }
}
```

**Error handling in `UmaClient`:**

| Condition | Behaviour |
|---|---|
| HTTP status ≠ 200 | throws `Error('uma: <endpoint> -> HTTP <status>')` — no `result_code` available |
| `result_code === 201` (SESSION_ERROR) | one automatic `onSessionError()` + retry — **the callback is not currently wired in `ApiClient`**, so today it just throws like any other code |
| any other `result_code !== 1` | throws `UmaError(code, endpoint, sid)` |
| `result_code === 1` | returns the envelope |

---

### 7.1 `tool/pre_signup`

**Wrapper:** `ApiClient.preSignup()` → `preSignup(client)`

**Request body:** `{}` — boilerplate only.

```json
{ "viewer_id": "440168743960", "device": 4, "device_id": "…", "locale": "ENG", … }
```

**Response `data`:**

```ts
interface PreSignupData {
  attest: boolean;                  // false
  nonce: string;                    // ""
  enable_steam_account: boolean;    // false
  country_list: { country: string; country_type: number }[];  // 167 entries
}
```

**Live sample:** 167 countries, first entry `{ "country": "United States", "country_type": 2 }`
(`country_type` values seen: 0, 1, 2 — the list is static, replayed from
`umaBack/server/data/seeds/country_list.json`).

**Used by:** `SessionStore.getCountryList()` → populates the signup dropdown.

---

### 7.2 `tool/signup`

**Wrapper:** `ApiClient.signup({ country, optinUserBirth, dmaState })` → `signup(client, params)`

**Request body:**

```ts
{
  country: string;           // from pre_signup country_list
  optin_user_birth: 0;       // 0 | 1
  dma_state: 0;              // 0 = not answered
}
```

**Response `data`:**

```ts
interface SignupData {
  viewer_id: number;   // 12-digit, JSON NUMBER (not string) — client does String(...)
  auth_key: string;    // base64 of 24 random bytes
}
```

**Shape sample:** `{ "viewer_id": 448123456789, "auth_key": "…" }`
(`viewer_id` is minted per signup, range `100_000_000_000`–`999_999_999_999`.)

**Side effects (server):** mints the account, seeds the post-tutorial `load/index` blob,
returns HTTP 200. It **never** returns an existing account.

**Side effects (client):** `signup()` calls `client.setViewerId(String(viewer_id))`
immediately, so the next call is already bound to the new account.

**Errors:** `205 PARAM_ERROR` on a malformed body. HTTP 500 is not expected.

---

### 7.3 `tool/start_session`

**Wrapper:** `ApiClient.startSession()` → `startSession(client)`

**Request body:**

```ts
{ attestation_type: 0, device_token: null }
```

**Response `data`:**

```ts
interface StartSessionData {
  attest: boolean;             // false
  nonce: string;               // ""
  terms_updated: boolean;      // false
  is_tutorial: boolean;        // false (server skips the tutorial by default)
  resource_version: string;    // e.g. "10006910"
}
```

**Extra `data_headers` on this endpoint:**

```json
"server_list": {
  "resource_server":        "assets-umamusume-en.akamaized.net/dl/vertical/",
  "resource_server_cf":     "assets-umamusume-en.akamaized.net/dl/vertical/",
  "resource_server_login":  "assets-umamusume-en.akamaized.net/dl/vertical/",
  "resource_server_ingame": "assets-umamusume-en.akamaized.net/dl/vertical/"
}
```

**Semantics:**

- Establishes a **fresh session base** and issues the first `sid`.
  Every later call rolls a new sid on that base.
- Does **not** require a prior sid — a random header sid is correct here.
- An unknown `viewer_id` is silently created; an **empty** `viewer_id` gets a session
  and then fails on the next call with HTTP 500.
- Do not call twice in a row from two tabs: the newest login wins.

**Used by:** `SessionStore.startSession()` right after `client.setViewerId(id)`.

---

### 7.4 `load/index`

**Wrapper:** `ApiClient.loadIndex()` → `loadIndex(client)`

**Request body:**

```ts
{ adid: "" }
```

**Response `data`:** **105 top-level keys** (live server, verified 2026-11-01).

The ones Phase 0 reads:

```ts
interface LoadIndexData {
  user_info: UserInfo;
  coin_info: { coin: number; fcoin: number };
  tp_info: { current_tp: number; max_tp: number; max_recovery_time: number };
  rp_info: { current_rp: number; max_rp: number; max_recovery_time: number };
  single_mode_scenario_id_array: number[];   // [1, 2, 3, 4]
  [key: string]: unknown;
}

interface UserInfo {
  viewer_id: string;
  name: string;
  honor_id: number;
  sex: number;                 // 0 unset, 1 male, 2 female
  fan: number;
  register_time: string;       // "YYYY-MM-DD HH:mm:ss"
  leader_chara_id: number;
  [key: string]: unknown;      // tutorial_step, comment, birth_day, rank_score, …
}
```

**Live sample (test account):**

```json
{
  "user_info": {
    "viewer_id": "440168743960",
    "name": "Trainer3960",
    "honor_id": 100101,
    "sex": 1,
    "fan": 747,
    "register_time": "2026-11-01 17:22:57",
    "leader_chara_id": 1009,
    "tutorial_step": 0,
    "rank_score": 0,
    "comment": "",
    "birth_day": ""
  },
  "coin_info": { "coin": 0, "fcoin": 0 },
  "tp_info": { "current_tp": 100, "max_tp": 100, "max_recovery_time": 0 },
  "rp_info": { "current_rp": 5, "max_rp": 5, "max_recovery_time": 0 },
  "single_mode_scenario_id_array": [1, 2, 3, 4]
}
```

**Scenario ids:** `1` URA · `2` unity_cup · `3` grand_live · `4` trackblazer.

**Other keys available for later phases** (not read in P0): `trained_chara`, `chara_list`,
`card_list`, `support_card_list`, `item_list`, `piece_list`, `gacha_banner_info`,
`home_banner_data_array`, `notice_data`, `login_bonus_list`, `menu_badge_info`,
`release_card_array`, `team_data_array`, `honor_info`, … (see the full 105-key list in
`umaBack/server/data/seeds/load_index_fresh.json`).

**Errors:**

- **HTTP 500** — `viewer_id` is empty / non-numeric. This is the failure mode P0 hit.
- `201 SESSION_ERROR` — stale sid **only if** `auth_enforce` is on (it is off today).

**Cost:** 0.2–0.6 s per call (server-dominated).

---

### 7.5 `read_info/index`

**Wrapper:** `ApiClient.readInfoIndex()` → `readInfoIndex(client)`
*(wrapper exists; not yet called by the UI)*

**Request body:** `{}` — optionally the ids the client just read:

```ts
{
  add_home_story_data_array?: { id: number }[];
  add_short_episode_data_array?: { id: number }[];
  add_home_poster_data_array?: { id: number }[];
  add_tutorial_guide_data_array?: { id: number }[];
  add_released_episode_data_array?: { id: number }[];
  add_talk_gallery_data_array?: { home_story_trigger_id: number }[];
  add_home_banner_data_array?: { id: number }[];
  add_viewed_story_array?: { id: number }[];
}
```

Request keys use the `add_` prefix; the server maps each to the corresponding
response key (`handlers/stories.py` `_READ_INFO_FAMILIES`).

**Response `data`** (7 keys, all always present):

```ts
interface ReadInfoData {
  home_story_data_array: { id: number }[];
  short_episode_data_array: { id: number }[];
  home_poster_data_array: { id: number }[];
  tutorial_guide_data_array: { id: number }[];
  released_episode_data_array: { id: number }[];
  talk_gallery_data_array: { home_story_trigger_id: number; new_flag: number }[];
  home_banner_data_array: { id: number }[];
  [key: string]: unknown;
}
```

**Live sample:** `tutorial_guide_data_array` = 22 ids (`10001…20004`), the rest empty on
a fresh account.

**Notes:** read-only for Phase 0 — the server unions whatever ids you post into a
per-viewer read set and returns the whole set. `ReadInfoData` in
`phase0.apitypes.ts` currently declares only 4 of the 7 keys (the index signature
covers the rest); extend it when the home screen starts using banners/stories.

---

### 7.6 `user/change_name`

**Wrapper:** `ApiClient.changeName(name)` → `changeName(client, name)`
**Store:** `SessionStore.changeName(name)` (requires `status === 'ready'`)

**Request body:** `{ name: string }`

**Response `data`:**

```ts
{ user_info: UserInfo }    // the full object, same shape as load/index → user_info
```

**Validation:**

| Side | Rule |
|---|---|
| client | `name.trim()`, length 1–16, non-empty |
| server | `str`, `strip()`, 1…16 (`_MAX_NAME_LEN = 16`); otherwise `205 PARAM_ERROR` |

**Side effect:** persisted into the stored `load/index` blob — the next login shows it.

---

### 7.7 `user/change_sex`

**Wrapper:** `ApiClient.changeSex(sex)` → `changeSex(client, sex)`
**Store:** `SessionStore.changeSex(sex)` (requires `status === 'ready'`)

**Request body:** `{ sex: 1 | 2 }` — `1` male, `2` female (no other values are accepted).

**Response `data`:**

```ts
{ user_info: UserInfo }
```

**Side effect:** also sets `user_info.tutorial_step = 1000` (skip tutorial) server-side.
This is where the server's skip-by-default hooks in — not in `tool/signup`.

**Errors:** `205 PARAM_ERROR` for any value other than `1` / `2`.

---

### 7.8 Endpoint summary

| Endpoint | Method | Body fields | Returns | Store action |
|---|---|---|---|---|
| `tool/pre_signup` | POST | — | `attest, nonce, enable_steam_account, country_list[167]` | `getCountryList()` |
| `tool/signup` | POST | `country, optin_user_birth, dma_state` | `viewer_id(number), auth_key` | `signUp()` |
| `tool/start_session` | POST | `attestation_type, device_token` | `attest, nonce, terms_updated, is_tutorial, resource_version` + `data_headers.server_list` | `startSession()` / `resume()` |
| `load/index` | POST | `adid` | 105 keys (`user_info, coin_info, tp_info, rp_info, single_mode_scenario_id_array, …`) | `startSession()` |
| `read_info/index` | POST | read-id arrays (optional) | 7 `*_data_array` / `*_list` keys | — (wrapper only) |
| `user/change_name` | POST | `name` | `user_info` | `changeName()` |
| `user/change_sex` | POST | `sex` | `user_info` | `changeSex()` |

All seven are POST, `Content-Type: application/x-msgpack; charset=utf-8`, body is the
base64 frame from §5 (not JSON on the wire — the JSON above is the decoded msgpack).

---

## 8. Remaining deltas / known issues

### 8.1 `node:fs` breaks the spec typecheck

`core/state/session.store.ts:5` still has `import { readSync } from "node:fs";`, unused.
`tsconfig.app.json` has `types: ["node"]` so the app passes, but `tsconfig.spec.json`
has `types: ["vitest/globals"]` → **`tsc -p tsconfig.spec.json` fails (TS2591)**.
Delete the import.

### 8.2 Signup race — **fixed**

The original template fired both actions in one expression:

```html
<!-- before -->
<button (click)="sessionStore.signUp(selectedCountry); sessionStore.startSession()">
```

Both statements start synchronously, so `startSession()` ran while `viewerid()` was
still `''`, hit the empty-id guard, and the account was minted but no session ever
started (and, before the guard, `load/index` returned HTTP 500).

The fix is one awaited store action, and the template calls only that:

```ts
async signUpAndStart(country: string): Promise<void> {
  await this.signUp(country);      // viewerid() is set when this resolves
  await this.startSession();       // empty-id guard now passes
}
```

```html
<!-- after -->
<button [disabled]="sessionStore.viewerid() !== ''"
        (click)="sessionStore.signUpAndStart(selectedCountry)">Sign Up</button>
```

`startSession()` also keeps its guard (`if (viewerid() === '') throw`) as a safety net
for any future out-of-order call.

**Double-click is knowingly not guarded.** `[disabled]` only flips after signup
resolves, so two fast clicks can still mint two accounts. This is accepted for now
because account creation moves behind Google login later (one Firebase uid → one
derived viewer id), which removes the button entirely rather than patching it.

### 8.3 Home shell shows wallet only

`home.component.html` renders `coin` / `fcoin`. The P0 milestone also calls for the
trainer name, viewer id, TP/RP and scenario banners (`scenarioIds`). The data is already
in the store — it's template work only.

### 8.4 Small leftovers

| # | Item | Where |
|---|---|---|
| 1 | `isValidViewerId()` accepts a leading zero | `account-id.ts` |
| 2 | login input is not validated; invalid ids reach the server | `signIn.component.html` |
| 3 | `status` never becomes `'error'` on a failed login (no try/catch) | `session.store.ts` |
| 4 | no error message UI | `signIn.component.html` |
| 5 | sign-out button is outside `<router-outlet/>`, so it shows on the login page too | `app.html` |
| 6 | `/home` has no route guard; `HomeComponent.ngOnInit` checks `idIsSet()` instead of `status() === 'ready'` | `home.component.ts` |
| 7 | `scenarioIds` is a plain array, not a signal | `session.store.ts` |
| 8 | `app.spec.ts` still asserts `querySelector('p')` against `<router-outlet/>`, and `App` now injects `Router` without a provider in the test | `app.spec.ts` |
| 9 | `read_info/index` wrapper is unused | `read_info.api.ts` |

---

## 9. Decisions already made (don't re-litigate)

| Decision | Choice | Why |
|---|---|---|
| Where the protocol lives | **In the frontend** | the relay stays a pure byte pipe, so only the browser can speak the game protocol |
| Relay | stateless passthrough — no session, no viewer_id injection | "no changes to the backend, no second backend server" |
| Login | **Firebase (Google) — deferred to the end** | the game client doesn't care where the viewer_id comes from; keep it behind one seam |
| Account binding | **derive it**: `viewer_id = 100000000000 + (int(sha256(uid)[0:12],16) % 900000000000)` | deterministic, no database, no Firestore rules, nothing tamperable |
| Credentials | the browser holds them | the Global server doesn't validate `auth_key` |
| Hosting | one shared webapp; **Cloudflare Tunnel** for the public HTTPS URL | required by Google OAuth (https redirect URIs) |
| Signup policy | open — but add a per-IP quota | every signup mints an account on the live server |
| Change detection | **zone.js** (plain class properties) | matches the existing style; signals used for the shared store |
| Google-native account linking | not used | the "Link App Data" endpoints need a password; Firebase + derivation is simpler |

**Firebase prerequisites (when we get there):** the web config goes in `src/environments/`
(public by design); add the host to Firebase **Authorized domains**; register the redirect
URI; **add every friend as a test user** (a project in *Testing* status rejects everyone else).

---

## 10. Local references

| Path | Why |
|---|---|
| `umaBack/server/app/crypto.py` | the wire format (91 lines) — the source we ported |
| `umaBack/server/app/accounts.py` (L303-321) | the sid chain |
| `umaBack/server/app/handlers/load.py` | `load/index`, `_neutralize_identity` (fresh-account naming) |
| `umaBack/server/app/handlers/circles.py:278` | the `int(viewer_id)` that 500s on non-numeric ids |
| `umaBack/server/app/handlers/tool.py` | `pre_signup` / `signup` / `tutorial/skip` |
| `umaBack/server/app/handlers/user_profile.py:399-460` | `change_name` / `change_sex` |
| `umaBack/server/app/handlers/stories.py:292-345` | `read_info/index` |
| `umaBack/server/app/result_codes.py` | result-code names |
| `umaBack/server/fixtures/capture_06d26c/` | 385 real REQ/RES pairs |
| `umaBack/server/data/seeds/load_index_fresh.json` | full 105-key home shape |
| `umaFront/uma/src/app/core/protocol/__fixtures__/golden-vectors.json` | 3 real captures → offline protocol tests |
| `browser-client-architecture.md` / `browser-client-phasing.md` | the master plan (P0–P5) |

**Measured cost:** gateway transform ≈ 1.07 ms CPU/request · webapp RSS 68 MB → ~95 MB plateau ·
the game server dominates latency (0.2–0.6 s per `load/index`) · browser bundle 72 KB gzip
(+8.6 KB when the browser carries msgpack + md5).
