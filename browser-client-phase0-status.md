# Phase 0 — Status & Handoff

**Project:** Umamusume browser client (Angular 22) talking to the live Global UmaPS server
**Repo:** `/root/umaServer/UmamusumePS` · **App:** `umaFront/uma`
**Game server (black box — never modify):** `https://umaserver.nanax3.xyz`
**Last updated:** 2026-10-20 · companion to `browser-client-architecture.md` + `browser-client-phasing.md`

---

## 0. Pick up here

Phase 0 = *"logged into the live server from a browser; home shell shows real viewer id, wallet and user info."*

**Next concrete task — chunk 3D:** finish the session store, add the account picker and the home screen.
Before that, clear the four open bugs in §5 (two of them will bite immediately).

| | |
|---|---|
| **Committed** | `d685c24` — protocol codec, api layer, relay, tools, fixtures, zone switch |
| **Uncommitted** | `core/accounts/account-id.ts`, `core/state/session.store.ts` (both WIP), the zone.js config |
| **Green** | `tsc --noEmit`, 9/10 vitest tests, `npm run check:client` against the live server |
| **Red** | 1 test failing (stale selector), 2 real bugs in `account-id.ts`, 1 in `session.store.ts` |

---

## 1. Verification commands

```bash
cd /root/umaServer/UmamusumePS/umaFront/uma

npm test                 # vitest via ng test  (9 protocol tests + app.spec.ts)
npm run check:client     # terminal e2e: UmaClient → relay → live server (167 countries)
npx tsc -p tsconfig.app.json --noEmit
npm start                # dev  → http://172.17.0.2:4200
npm run build && npm run serve:ssr:uma    # prod → http://172.17.0.2:4000
```

> **Container:** the app runs in Docker. `localhost` works *inside* the container; from a browser use
> the container IP **172.17.0.2** (`hostname -i` to re-check — it can change on recreate).

---

## 2. Done ✅

| Chunk | What | Notes |
|---|---|---|
| **1 — Relay** | dev proxy (`proxy.conf.mjs`, `/g/*`) + prod forwarder in `src/server.ts` | Both verified. Express 5 hands wildcard params over as an **array** — `req.params.splat.join('/')`, not the string. |
| **2 — Protocol codec** | `core/protocol/`: `constants, bytes, msgpack, aes, envelope, sid` | 8 tests against **real captured traffic** (`__fixtures__/golden-vectors.json`). |
| **3A — Client + api** | `uma-client.ts`, `core/api/*` (`tool/load/read_info` + models), `testStuff/protocol-check.component.ts` | 167-country dropdown works. |
| **Tooling** | `tools/check-client.ts` + `npm run check:client` | runs the *same* `UmaClient` in Node against the live server. |
| **Zone switch** | `zone.js` + `provideZoneChangeDetection()` | plain class properties now work like in other projects. |
| **3D (start)** | `core/accounts/account-id.ts`, `core/state/session.store.ts` | skeleton — see §5. |

### File map (as committed)

```
umaFront/uma/
├── proxy.conf.mjs                 dev proxy: /g/* → https://umaserver.nanax3.xyz
├── tools/check-client.ts          terminal e2e against the live server
├── src/server.ts                  prod relay (Express 5) — stateless byte pipe
├── src/types/blueimp-md5.d.ts     ambient types (the package ships none)
└── src/app/
    ├── core/
    │   ├── protocol/              the wire codec (no Angular deps)
    │   ├── api/                   typed endpoint wrappers (pure functions)
    │   ├── accounts/              account-id.ts            ← WIP
    │   └── state/                 session.store.ts         ← WIP
    └── testStuff/protocol-check.component.ts   debug screen
```

---

## 3. The wire protocol (settled — don't redesign)

```
request  = base64( u32LE(len(header)) + header + body )
header   = HEAD(52) + sid(16) + udid(16) + random(32) + auth(var)
body     = AES-256-CBC(key, iv)( u32LE(len(msgpack)) + msgpack ) + key(32, in the clear)
iv       = ascii( hex(udid)[0:16] )
response = base64( ciphertext + key )
envelope = { response_code:1, data_headers:{ result_code, sid(42hex), viewer_id, servertime, … }, data:{…} }
```

Hard-won rules — each one cost a debugging session:

1. **The real error is `data_headers.result_code`, never `response_code`** (that stays `1` even on failure). `205` = PARAM_ERROR, `201` = SESSION_ERROR.
2. **WebCrypto AES-CBC pads and unpads PKCS#7 itself** — do not pad/unpad by hand.
3. **IV = ASCII of the first 16 hex chars of the udid**, not the raw bytes.
4. **The response key is the LAST 32 bytes** of the base64-decoded body.
5. **The header length prefix is OUTSIDE the cipher; the payload length prefix is INSIDE it.**
6. **The sid chain:** the next request's header sid = `md5(last_sid_string + "co!=Y;(UQCGxJ_n82")` (16 raw bytes). The server's sid is a stable 32-hex base + a rotating 10-hex suffix.
7. **`viewer_id` must be a 12-digit NUMERIC string.** A Firebase-style alphanumeric id → `start_session` returns 200, then `load/index` **HTTP 500** (the server does `int(viewer_id)` in `handlers/circles.py:278`).
8. **Payload boilerplate** (from a real capture): `viewer_id, device:4, device_id, device_name, graphics_device_name, ip_address, platform_os_version, carrier, keychain, locale:"ENG", button_info, dmm_viewer_id, dmm_onetime_token, steam_id, steam_session_ticket` (+ `adid` for load/index, `attestation_type`/`device_token` for start_session).

---

## 4. The server's identity model (verified against the source)

- Identity = **the `viewer_id` string in the payload. Nothing else.**
- `accounts.sqlite3`: `viewer_id` PK + `auth_key, sid, created_at, last_seen, transition_password, pending_deletion_at, udid`.
- `state.sqlite3`: `viewer_state_kv (viewer_id, key, value)` — the entire game state is rows keyed by viewer_id.
- `udid` → only derives the IV (Global). `sid` → only enforced when `auth_enforce` is on (**it is false**). `auth_key` → stored but **never validated** on Global. `steam_id` / `device_id` → echoed back, never used for lookup.
- **An unknown viewer_id is silently created** (`accounts.touch()` upserts; `load/index` seeds the blob) — no error, so a typo looks like "the game wiped my account".
- `tool/signup` **always** mints a new account; it never returns an existing one. Returning players call `tool/start_session` with their stored id. **The server never decides new-vs-returning — the client does.**
- **`tool/signup` is not needed.** An implicit account works fine (verified: `790657293395` → 105-key home blob, `name: "Trainer3395"`, `register_time: now`).
- A fresh account's `user_info.name` is auto-derived as `Trainer` + the last 4 digits of the id (`load.py` `_neutralize_identity`); `user/change_name` exists if we ever want a real name.

---

## 5. ⚠️ Open bugs

### `src/app/core/accounts/account-id.ts`
1. **`if (i = 0)` — assignment, not comparison** (line 10). `i = 0` evaluates falsy, so the "first digit" branch never runs, *and* it resets `i` every iteration, so the loop **never terminates** (`i` only ever reaches 1) → the tab hangs and the string grows unbounded. Fix: `if (i === 0)`.
   *TypeScript does not catch this, and there is no ESLint in this project — a unit test is the only safety net.*
2. **The validator accepts a leading zero** (`"012345678901"` → true). The server's id is the string key but `int()`s it elsewhere, so two spellings can mean one account. Reject or strip leading zeros.
3. **No unit test yet.** Suggested:
   ```ts
   it('always makes a valid 12-digit id', () => {
     for (let i = 0; i < 1000; i++) expect(newViewerId()).toMatch(/^[1-9][0-9]{11}$/);
   });
   ```
   (On the current code this test hangs — wrap it in a `Promise.race` with a timeout so a hang becomes a failure.)

### `src/app/core/state/session.store.ts`
4. **State fields are `readonly`** but the actions must assign them → TS error on the first assignment (`readonly` only allows assignment in the constructor). With zone.js enabled, plain **mutable** properties are the coherent choice — drop `readonly`. (The file compiles today only because the actions section is still empty.)
5. The `status` union should be exported as a named type.
6. Actions still to write — see §6.

### `src/app/app.spec.ts`
7. **The one failing test.** It asserts `querySelector('p')` but `app.html` is now `<router-outlet/>` → change the selector to `'router-outlet'`.

---

## 6. Next: chunk 3D

### 6a. `SessionStore` actions
```ts
resume(): void                   // on app start: if localStorage has a viewer_id → connect
useAccount(id): Promise<void>    // persist id → tool/start_session → load/index → fill state
createNewAccount(): Promise<void>// newViewerId() → useAccount()
signOut(): void                  // clear localStorage, back to the picker
```
State: `status` (`idle|connecting|ready|error`), `viewerId`, `userInfo`, `wallet {coin,fcoin,tp,rp}`,
`scenarioIds`, `error`.
`load/index` returns **105 keys**; the ones we need are `user_info`, `coin_info`, `tp_info`, `rp_info`,
`single_mode_scenario_id_array` (→ `[1,2,3,4]` = URA / unity_cup / grand_live / trackblazer).

### 6b. `features/boot/account-picker/`
- "Enter trainer ID" — 12-digit input, validated → connect
- "Create new account" → `newViewerId()` → connect
- loading state + a readable error when `result_code != 1`

### 6c. `features/home/`
User info card · wallet cards (coin / TP / RP) · scenario banners · notification badge · sign out.

### 6d. Routing
```
''     → AccountPickerComponent   (redirect to /home if a session is ready)
'home' → HomeComponent            (guard: no session → back to the picker)
```
`app.routes.server.ts` is already `RenderMode.Client` ✓ and `app.html` is `<router-outlet/>` ✓.

### 6e. P0 acceptance checklist
- [ ] clear localStorage → "create new account" → home shows name, wallet, scenarios
- [ ] reload → auto-resume, no re-login
- [ ] sign out → sign back in with the same id
- [ ] `npm run build` → the built app does the same through the prod relay

---

## 7. Decisions already made (don't re-litigate)

| Decision | Choice | Why |
|---|---|---|
| Where the protocol lives | **In the frontend** | the relay stays a pure byte pipe, so only the browser can speak the game protocol |
| Relay | stateless passthrough — no session, no viewer_id injection | "no changes to the backend, no second backend server" |
| Login | **Firebase (Google) — deferred to the end** | the game client doesn't care where the viewer_id comes from; keep it behind one seam |
| Account binding | **derive it**: `viewer_id = 100000000000 + (int(sha256(uid)[0:12],16) % 900000000000)` | deterministic, no database, no Firestore rules, nothing tamperable |
| Credentials | the browser holds them | the Global server doesn't validate `auth_key` |
| Hosting | one shared webapp; **Cloudflare Tunnel** for the public HTTPS URL | required by Google OAuth (https redirect URIs) |
| Signup policy | open — but add a per-IP quota | every signup mints an account on the live server |
| Change detection | **zone.js** (plain class properties) | matches the user's existing style; signals are still nicer for a shared store later |
| Google-native account linking | not used | the "Link App Data" endpoints need a password; Firebase + derivation is simpler |

**Firebase prerequisites (when we get there):** the web config goes in `src/environments/` (public by
design); add the host to Firebase **Authorized domains**; register the redirect URI; **add every
friend as a test user** (a project in *Testing* status rejects everyone else).

---

## 8. Local references

| Path | Why |
|---|---|
| `umaBack/server/app/crypto.py` | the wire format (91 lines) — the source we ported |
| `umaBack/server/app/accounts.py` (L303-321) | the sid chain |
| `umaBack/server/app/handlers/load.py` | `load/index`, `_neutralize_identity` (fresh-account naming) |
| `umaBack/server/app/handlers/circles.py:278` | the `int(viewer_id)` that 500s on non-numeric ids |
| `umaBack/server/app/handlers/tool.py` | `pre_signup` / `signup` |
| `umaBack/server/app/result_codes.py` | result-code names |
| `umaFront/uma/src/app/core/protocol/__fixtures__/golden-vectors.json` | 3 real captures → offline protocol tests |
| `browser-client-architecture.md` / `browser-client-phasing.md` | the master plan (P0–P5) |

**Measured cost:** gateway transform ≈ 1.07 ms CPU/request · webapp RSS 68 MB → ~95 MB plateau ·
the game server dominates latency (0.2–0.6 s per `load/index`) · browser bundle 72 KB gzip
(+8.6 KB when the browser carries msgpack + md5).
