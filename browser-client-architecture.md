# Umamusume Browser Client (Angular) — Findings & Ground-Structural Plan

Goal: turn the Unity game in `UmaGame/` into a browser client built on the Angular
scaffold in `umaFront/uma`, with all game API calls answered by the **already
running** private server at `https://umaserver.nanax3.xyz`.
The server is a fixed black box — **no server changes**. `UmamusumePS/` and
`UmaGame/` are reference material / extraction source only.
Companion doc: `umamusume-server-architecture.md` (server internals).

---

## 1. Verified facts this plan rests on

| Fact | How verified |
|---|---|
| `umaserver.nanax3.xyz` is a **Global-transport UmaPS**: real Let's Encrypt cert (`CN=nanax3.xyz`), behind **Cloudflare**, **no CORS headers** (`OPTIONS` → 405), Cloudflare blocks non-browser UAs (error 1010) | Live smoke test from this box, 2026-10-20 |
| The full login flow works headlessly against the live server: `tool/pre_signup` → `tool/signup` (mints 12-digit `viewer_id` + base64 `auth_key`) → `tool/start_session` (42-hex `sid`, CDN `server_list`) → `load/index` (**105-key** home blob). Served scenario ids: **[1, 2, 3, 4]** (URA, unity_cup, grand_live, trackblazer) | Live protocol replay (test viewer `440168743960` created) |
| Wire protocol is fully browser-implementable and secretless: `base64(u32LE header_len + header + AES-256-CBC(msgpack) + key32)`, header = 52-byte `HEAD` magic + sid(16) + udid_raw(16) + random(32) + auth(var); **IV = `udid_raw.hex()[:16]` as ASCII**; AES key is random per message and appended in the clear | `UmamusumePS/server/app/crypto.py` + successful live replay |
| Error convention (Global): `response_code` stays `1`, the error is in `data_headers.result_code` (default `205 PARAM_ERROR`), `data` is `{}` | Server source + live responses |
| sid chain: each response carries a 42-hex `sid` in `data_headers`; the next request's 16-byte header sid must be `md5(sid + "co!=Y;(UQCGxJ_n82")` when `auth_enforce` is on (live state unknown → **implement chaining regardless**) | `UmamusumePS/server/app/accounts.py` (`_SID_SALTS`) |
| Response content type: `application/x-msgpack; charset=utf-8`, body = `base64(ciphertext + key)` | Live responses + `app/main.py` |
| Reference material available locally: **385 captured REQ/RES fixture pairs** (27 endpoints, `fixtures/capture_06d26c/`), `server/data/seeds/load_index_fresh.json` (full 103-key home shape), decryptable `Persistent/meta` catalog + a working UnityPy extraction recipe (`tools/extract_race_assets.py`), and an existing **top-down canvas race-replay viewer** (`admin_panel/static/race-viewer.js`) | Local scans |
| `UmaGame/` install: Unity 2022.3.62f2 IL2CPP Win64 Steam build v1.35.2; `Persistent/master/master.mdb` (17 MB, 416 tables incl. `text_data` = localization); `Persistent/meta` (77 MB encrypted SQLite catalog, name→hash, decryptable via apsw hexkey); `Persistent/dat/` 15 GB / 169,348 content-addressed files (159k UnityFS bundles, 4.5k AWB audio, 5k ACB cue tables, 400 CRI USM movies) | Local scan |
| `umaFront/uma` is a pristine **Angular 22.2 + SSR (Express)** scaffold; its `src/server.ts` is the natural home for the same-origin API relay | Read |

## 2. Constraints & consequences

1. **The game server cannot be modified** → it sends no CORS headers and its
   Cloudflare zone blocks non-browser clients. Therefore the browser must **never**
   call `umaserver.nanax3.xyz` directly. The webapp ships its own thin,
   stateless **passthrough edge** (part of the webapp's own deployment).
2. All static game data (localization, card/chara/skill tables) and all assets
   (art, icons, course geometry, audio) must come from **build-time extraction**
   against the local `UmaGame/` install — the server is not asked for any of it.
3. ~689 Global endpoints exist; unhandled ones get `NOOP_SUCCESS` from the
   server, so the client only implements what its UI actually calls. Fixtures
   provide ground-truth request shapes for the 27 hottest endpoints
   (`check_event` ×350, `exec_command` ×132, career family, login chain).

## 3. Three-layer architecture

```
┌────────────────────────────────────────────────────────┐
│  A. Angular app (umaFront/uma)                         │
│     protocol codec · api layer · state · features      │
└──────────────┬─────────────────────────────────────────┘
               │ same-origin fetch  (/g/**, /assets/**)
┌──────────────▼─────────────────────────────────────────┐
│  B. Webapp's own edge (existing SSR Express server,    │
│     or nginx in prod) — pure passthrough:              │
│     • /g/**  → https://umaserver.nanax3.xyz  (browser- │
│       safe UA; zero game logic)                        │
│     • /assets/** → statically served extracted assets  │
└──────────────▲─────────────────────────────────────────┘
               │ build-time only (never at runtime)
┌──────────────▼─────────────────────────────────────────┐
│  C. Offline pipeline (new, `umaFront/pipeline/`,       │
│     Python/Node, run on this box against UmaGame/ +    │
│     reference UmamusumePS/)                            │
│     master.mdb → JSON  ·  meta+UnityPy → web assets    │
└────────────────────────────────────────────────────────┘
```

### Layer B — passthrough edge
- **Dev:** Angular dev-server `proxy.conf` → `/g/*` rewritten to
  `https://umaserver.nanax3.xyz/*` with a browser-like UA header.
- **Prod:** extend `src/server.ts` (or nginx): `app.all('/g/*', relay)`.
  Bytes in, bytes out; also serves `/assets/**` from Layer C output.
  This is the only new "server" code, and it belongs to the webapp.

## 4. Layer A — Angular app structure

```
src/app/
├── core/
│   ├── protocol/          # the wire codec, zero Angular deps
│   │   ├── msgpack.ts     # msgpackr wrapper
│   │   ├── aes.ts         # WebCrypto AES-256-CBC (PKCS7), key-append framing
│   │   ├── envelope.ts    # HEAD magic, u32LE header, sid/md5-salt chain
│   │   └── uma-client.ts  # call(endpoint, body) → decoded envelope;
│   │                      #   sid rotation, 201 SESSION_ERROR → auto re-login,
│   │                      #   viewer_id/auth_key/udid persistence (localStorage)
│   ├── api/               # typed endpoint groups mirroring server handlers:
│   │   ├── load.api.ts  tool.api.ts  single-mode.api.ts  race.api.ts
│   │   ├── gacha.api.ts  cards.api.ts  user.api.ts  social.api.ts ...
│   │   └── models/        # TS interfaces — GENERATED from fixtures (§6.5)
│   └── state/             # Angular signal stores: session, wallet, cards,
│                          # charas, notifications, scenario state
├── data/
│   ├── master.service.ts  # lazy-loads build-exported master JSON (§6)
│   └── text.service.ts    # localization over text_data categories
├── features/
│   ├── boot/              # title → pre_signup/signup-or-login →
│   │                      #   start_session → load/index pipeline
│   ├── home/              # main shell: profile, wallet, banners, menus
│   ├── career/            # THE core loop: turn dashboard, exec_command,
│   │                      #   check_event viewer + choices, gain_skills,
│   │                      #   race hooks, finish/factors — scenario-aware
│   ├── race/              # race entry UI + replay viewer component
│   ├── gacha/  deck/  profile/  friends/  missions/  mail/  story/  shop/
├── render/
│   └── race-viewer/       # canvas 2D top-down replay (adapted from the
│                          #   proven admin_panel race-viewer.js); three.js
│                          #   3D is a later stretch goal
└── shared/                # game-style UI kit (windows, buttons, icons,
                           #   rarity frames, number formatting) + SCSS tokens
```

Protocol implementation notes:
- WebCrypto `subtle.encrypt/decrypt('AES-CBC')` covers the cipher (PKCS7 by default).
- msgpack via `msgpackr`; **md5 via a small lib** (WebCrypto has no MD5) — used
  only for the sid salt.
- `udid` (16 random bytes) generated once and persisted with `viewer_id`/`auth_key`.
- The standard payload boilerplate (`viewer_id, device, device_id, device_name,
  graphics_device_name, ip_address, platform_os_version, carrier, keychain,
  locale:"ENG", button_info, dmm_viewer_id, dmm_onetime_token, steam_id,
  steam_session_ticket`; `adid` for `load/index`; `attestation_type`/`device_token`
  for `start_session`) is attached by `uma-client` on every call.

## 5. Wire protocol quick reference (Global, as deployed)

```
request  = POST body: base64( u32LE(len(header)) + header + body )
header   = HEAD(52) + sid(16) + udid_raw(16) + random(32) + auth(variable)
body     = AES-256-CBC(key, iv)( pad( u32LE(len(msgpack)) + msgpack ) ) + key(32)
iv       = udid_raw.hex()[:16] as ASCII
response = base64( ciphertext + key ), Content-Type: application/x-msgpack; charset=utf-8
envelope = { response_code:1,
             data_headers:{ result_code, notifications, viewer_id, sid(42hex), servertime,
                            server_list? },
             data:{...} }
errors   = data_headers.result_code != 1  (response_code stays 1, data = {})
sid next = md5( data_headers.sid + "co!=Y;(UQCGxJ_n82" )  → 16-byte header sid
endpoint = URL path (bare "feature/action"; optional leading "umamusume/" stripped server-side)
```

`HEAD` constant (hex):
`6b20e2ab6c311330f761d737ce3f3025750850665eea58b6372f8d2f57501eb344bdb7270a9067f5b63cd61f152cfb986cbfbf7a`

## 6. Layer C — offline asset & data pipeline (`umaFront/pipeline/`, new)

1. **`export-master`** — read-only `master.mdb`
   (`UmaGame/UmamusumePrettyDerby/UmamusumePrettyDerby_Data/Persistent/master/master.mdb`)
   → per-table JSON: `text_data` split by category (localization),
   `chara_data`, `support_card_data`, `skill_data`, `race`, `race_track`,
   `gacha_data`, `item_data`, story tables, etc. Version-stamped.
   (`text_data` schema: `id, category, index, text`.)
2. **`extract-assets.py`** — port of the reference recipe
   (`UmamusumePS/tools/extract_race_assets.py`): decrypt `Persistent/meta`
   (apsw + hexkey, key = `Config.GlobalDBKey XOR DBBaseKey[i % 13]`) →
   name→hash catalog → UnityPy extraction of targeted subsets: card/chara art
   (Texture2D → webp/png), UI icons, race course lane geometry.
   **Shortcut already on disk:** `UmamusumePS/server/data/course_paths.json`
   (2.2 MB) and `race_param_define_global.json` (73 MB) are pre-extracted race
   data — reuse directly.
3. Audio (ACB/AWB → ogg) and movies (USM → mp4/webm) only when a feature needs
   them — skip initially.
4. Optional enrichment: named vertical art from the public CDN
   `assets-umamusume-en.akamaized.net/dl/vertical/` (returned in
   `server_list`) fetched **through the Layer-B proxy** → CORS-free, no server
   change.
5. **`gen-models.ts`** — decode the 385 fixture REQ/RES pairs
   (`UmamusumePS/server/fixtures/capture_06d26c/`) + `load_index_fresh.json`
   → TypeScript interfaces for `core/api/models/`. Turns captured real-client
   traffic into compile-time types.

## 7. Phasing (each phase ships something playable)

| Phase | Content | Milestone |
|---|---|---|
| **P0 Foundations** | protocol codec, `uma-client`, proxy config, boot flow (signup/login → start_session → load/index), home shell showing user/wallet | Logged into the live server in a browser |
| **P1 Data layer** | master export + localization + icon/art extraction; card/chara rendering components | Real names/art everywhere |
| **P2 Career core** | URA scenario (id 1): start/load, turn dashboard, training commands, event viewer + choices, skill acquisition, finish; then scenario framework generalizes to ids 2–4 (unity_cup, grand_live, trackblazer) | Full training loop playable |
| **P3 Races** | race_entry → analyze → start/end/out; 2D top-down canvas replay viewer (admin-panel logic as reference, extracted course geometry as data); then daily/practice races | Watch your race play out |
| **P4 Meta systems** | gacha, support decks, succession/factors (`trained_chara/*`), presents, missions, profile/honors, friends | Account metagame |
| **P5 Long tail** | story reader, shop/exchange, jukebox/live audio, room/circle — optionally a three.js 3D race viewer (glTF chara models) as stretch | |

## 8. Risks & decisions

1. **Race presentation** — 3D rendering is the single biggest cost. Recommended:
   ship the 2D canvas replay (proven reference implementation) in P3; treat a
   three.js 3D viewer as an optional stretch. *Open decision.*
2. **Asset naming conventions** (card id → bundle/art file) — derived from the
   meta catalog names + community conventions (UmaViewer/umatl); validated
   against the CDN. Medium risk, isolated in Layer C.
3. **Cloudflare** may one day flag the relayed traffic — mitigated by
   browser-like UA on our own server; nothing to do now.
4. **15 GB source store** — the pipeline extracts only targeted subsets
   (a few GB at most), never the whole store.
5. **Live `auth_enforce` state unknown** — sid chaining implemented unconditionally.

## 9. Appendix — useful local paths

| Path | Why it matters |
|---|---|
| `UmamusumePS/server/app/crypto.py` | Ground-truth Global wire codec (reimplement in TS) |
| `UmamusumePS/server/fixtures/capture_06d26c/` | 385 real REQ/RES pairs → codegen source for models |
| `UmamusumePS/server/data/seeds/load_index_fresh.json` | Full `load/index` response shape |
| `UmamusumePS/server/data/course_paths.json`, `race_param_define_global.json` | Pre-extracted race course data for the 2D viewer |
| `UmamusumePS/admin_panel/static/race-viewer.js` | Proven browser race-replay viewer (canvas, top-down) — port reference |
| `UmamusumePS/tools/extract_race_assets.py` | meta decryption + UnityPy extraction recipe to port |
| `UmaGame/.../Persistent/master/master.mdb` | Localization + all static game tables |
| `UmaGame/.../Persistent/meta` (+ `meta-journal`) | Encrypted asset catalog (name → dat/ hash) |
| `UmaGame/.../hachimi/redirect.cfg` | Confirms the live server host and feature flags |
| `umaFront/uma/src/server.ts` | SSR Express app to extend with the `/g/*` relay |
