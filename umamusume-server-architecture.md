# Umamusume Private Server (UmaPS) — Architecture

Scope: how the **Global** private server works, with JP differences noted.
Scanned from `UmamusumePS/` (deeper only, never up).

## 1. Top-level layout

| Path | Role |
|---|---|
| `start-global.sh` / `.ps1`, `start-jp.sh` / `.ps1` | Thin wrappers; exec `server/launcher.py --region global\|jp` |
| `server/launcher.py` | One-stop bootstrap: venv, TLS cert, Rust build, game discovery, then boots the server |
| `server/app/` | The game-logic server package (Global entry `app.main:app`) |
| `server/app/jp/` | JP-only process (own transport, endpoints, features) |
| `server/data/` | Per-region runtime data: SQLite DBs, seeds, extracted race assets |
| `server/fixtures/` | Captured real-client request/response pairs (fallback replay source) |
| `server/race_exact_rs/`, `race_engine_rs/` | Rust race simulators invoked as subprocess workers |
| `plugin/hachimi_redirect/` | Rust DLL loaded by Hachimi Edge that redirects the client to this server |
| `admin_panel/` | Loopback web admin UI (embedded into the server process) |
| `admin.py`, `career.py`, `tools/` | CLI cheats and asset extraction |

There are **two independent server processes** (Global on `:8443`, JP on `:8444`),
each with its own data dir and its own wire transport. Admin panels: Global
`:8189`, JP `:8190`.

## 2. Boot sequence (`server/launcher.py`)

Every run, idempotently:

1. **venv** — creates `server/.venv`, installs `requirements.txt` (re-installs
   only when the hash changes).
2. **TLS cert** — mints a self-signed key/cert per region into `server/certs/`
   (the plugin trusts it, nothing goes in the OS trust store).
3. **Rust engines** — checks for `cargo`, offers rustup install, builds
   `race_exact_rs` / `race_engine_rs` when sources are newer than binaries.
4. **Game install** — finds the Steam install, sets `MASTER_MDB_PATH` to its
   `master.mdb`, and extracts race course data via
   `tools/extract_race_assets.py` (JP also links the Global `master.mdb` as an
   English-text overlay).
5. **Start** — runs `uvicorn app.main:app` (Global) over HTTPS, starts the
   embedded admin panel and opens a browser.

The server reads **all game data from the user's own `master.mdb`** — no
proprietary assets are shipped.

## 3. Wire protocol — how the client talks to it

**Global** (`server/app/crypto.py`). No client modification needed because the
plugin only rewrites the URL. Request body is base64 of:

```
u32_LE(header_len) + header + body
header = 52-byte fixed magic + sid(16) + udid_raw(16) + random(32) + auth(var)
body   = AES-CBC(key, iv)( u32_LE(payload_len) + msgpack(payload) ) + key(32B, in clear)
iv     = udid_raw.hex()[:16] as ASCII
```

Key is generated per-message and travels appended to the ciphertext, so the
server needs **no shared secret** — it just parses `udid` out of the header to
derive the IV. Response is `base64(ciphertext + key)`, sent as
`application/x-msgpack; charset=utf-8`. The entry route is
`app/main.py::dispatch`, which base64-decodes → `crypto.decode_request` →
pipeline → `crypto.encode_response`.

The 52-byte magic `HEAD` is a fixed constant baked into both client and server.

**JP** (`server/app/jp/transport.py`) is different: the JP client seals each
request to an X25519 public key it believes is Cygames'. Two envelope types
(`0xA6` session, `0x74` boundary/signup), GCM, per-build `tail20` constants,
per-viewer session state (`udid` + `tail50`, where `tail50` = the `auth_key`
issued at signup). Replies are gzip(base64(wire)). The plugin handles creating
and arming this seal (`app/jp/arming.py`, `coneshell.py`).

## 4. The request pipeline (`server/app/dispatch.py`)

`handle_decoded(endpoint, payload, sid)` is the shared core both regions use:

1. Strip the `umamusume/` prefix; pull `viewer_id`.
2. **Per-viewer lock** (`accounts.viewer_lock`) — serializes one account's
   requests; different accounts stay concurrent.
3. `custom_support.preflight` (custom support cards), lazy account-deletion
   sweep on `tool/start_session`.
4. **Session/sid** — `tool/start_session` mints a fresh 32-hex base; every
   other reply rolls a new 10-hex suffix (`session.py`), matching the real
   server's observed behavior. `accounts.check_session` enforces when
   `auth_enforce` is on (sid mismatch → `SESSION_ERROR` 201).
5. **Maintenance / feature-maintenance** short-circuits from `client_config.json`.
6. **Handler lookup**: `HANDLERS` dict → `handlers/registry.py` self-registered
   modules → **fixture fallback** (`fixtures.py`: replay the closest captured
   real response) → else a bare `NOOP_SUCCESS` envelope. Unsupported scenario
   starts are *refused* (205), never no-op'd, to avoid client softlocks.
7. **Post-processing**: version-compat patching,
   `single_mode_team.sync_chara_info` (forces the live character's data into
   replies so captured fixtures can't leak the captured character's stats),
   concert songs, event-gallery recording.
8. **Envelope patching** (`patch.py`): scrubs `<redacted>` placeholders, echoes
   viewer/device fields, forces `servertime`, stamps `sid`, clamps int32 wallet
   fields.

Design seam: "everything is a handler, with fixture replay as scaffolding."
`HANDLERS` holds the core; feature modules self-register via
`@registry.endpoint("...")` in `handlers/registry.py`, so new features never
edit `dispatch.py`.

## 5. Persistence & identity

- **`state.py`** — per-viewer game state in `state.sqlite3`, one SQLite row per
  top-level key. Big keys are lazy (`_LAZY_KEYS`), the whole DB text is cached
  in memory, writes are write-through. Edits from admin tooling/CLI appear on
  the next request via `PRAGMA data_version` invalidation.
- **`accounts.py`** — `accounts.sqlite3`: `viewer_id`, `auth_key`, `sid`,
  `transition_password` (data-link / "log in elsewhere"), `pending_deletion_at`,
  `udid`. Owns the per-viewer lock.
- **`region.py`** — single source of truth for Global vs JP; `data_dir()`
  namespaces every per-region file so the two processes can never read each
  other's saves.

## 6. Game data — `master.mdb`

`master_data.py` opens the client's `master.mdb` read-only and reuses one
connection. All static tables (characters, support cards, skills, races, gacha
odds, scenario release dates) come from here. Schema differs by region (Global
416 tables, JP 627), so `has_table` / `has_column` guard region-specific
features. On JP, a `TEMP VIEW` overlays Global's English `text_data` for
matching.

## 7. Career / scenario engine

- `handlers/single_mode_team.py` is the single shared career implementation;
  **all scenarios post to their own endpoint prefix but share the same
  handlers** — `_install_scenario_routes()` aliases each prefix onto the same
  handler objects.
- `scenarios/` holds one package per scenario (`ura`, `unity_cup`, `grand_live`,
  `trackblazer`, `venus`, `arc`, `sport`, `cook`, `mecha`, `legend`, `pioneer`,
  `onsen`, `breeders`, `ramen`). `base.py` defines a `Scenario` = data + hooks,
  with neutral URA defaults, so shared code calls e.g.
  `scenarios.for_chara(chara_info).friendship_bonus_pct(...)` and never branches
  per scenario. Adding a scenario = a package + one line in
  `registry._SCENARIO_MODULES`.
- Supporting engines: `career_events.py` (event queue / fired set),
  `event_engine.py`, `training_formula.py` (training/stat math), `epithets.py`,
  `rating_formula.py`.

## 8. Race simulation

`simulation/` drives **Rust workers** (`race_exact_engine.py` →
`race_exact_rs`, and `race_simulator.py` → `race_engine_rs`) via stdin/stdout
JSON, with `scenario_format.py` encoding the client's `RaceSimulateData` framing
(timestamped horse frames, results, skill/race events; gzip/base64 replays).
`race_exact_rs` is the 1:1 Global implementation tested against thousands of
real races; `race_engine_rs` is the more general one used for JP / >18 runners.

## 9. JP specifics

Same pipeline and handlers, different transport and extra layers:
`jp/endpoints.py` (signup mints the session key, JP-shaped `start_session`),
`jp/features/*` (skill upgrades, succession, step-up, exhibition, etc.),
`jp/schema.py` (conform replies to the real JP shape), `jp/story_ids.py`,
`jp/arming.py` (arming channel on port 8090 the plugin talks to). JP keeps
**no fixture replay** — every answer comes from a handler.

## 10. Admin panel & tooling

`admin_panel/` is an HTTP server (`server.py`) embedded in the game server via
`admin_lifecycle.py::lifespan` (runs on a daemon thread, real subprocess workers
per region). `admin_panel/ops/*` implement operations (users, umas, supports,
races, career tuning, custom supports) against the same SQLite state;
`static/*.js` is the browser UI. Root CLIs `admin.py` (wallet/cards/roster/mail)
and `career.py` (in-progress career: turn, goals, race history, events) edit
state directly.

## 11. The redirect plugin (`plugin/hachimi_redirect/src/lib.rs`)

Hachimi Edge loads it and hooks, all resolved **by name** to survive updates:

1. `WWWRequest.Post` — rewrites `api.games.umamusume.{com,jp}` to the
   configured server.
2. TLS — accepts the self-signed cert for that one host.
3. JP X25519 seal.
4. Request censor — blanks device/Steam identifiers while redirecting.

Plus optional capture / client-log / big-fields / code-dump modes. Settings live
per-install in `<hachimi dir>/redirect.cfg`.

## End-to-end example (Global login → career)

```
client -> plugin rewrites URL, TLS accepted
       -> HTTPS POST base64(header+body)         [main.py::dispatch]
       -> crypto.decode_request                  [udid->IV, AES-CBC, msgpack]
       -> handle_decoded("tool/start_session")   [dispatch.py]
          -> accounts.touch, session.start_session
          -> HANDLERS[...] / fixture replay
          -> _apply_version_compat, patch_response
       -> crypto.encode_response -> application/x-msgpack
```

Players then hit `load/index` (LoginTask), `single_mode/*` (career via shared
handlers + the chara's scenario hooks), races (via the Rust engine),
gacha/shop/etc. — all backed by `master.mdb` + the per-viewer SQLite state, with
captured fixtures covering the long tail.
