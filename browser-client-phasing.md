# Browser Client — Phasing Plan

Companion to `browser-client-architecture.md` (§7 holds the summary table; this
file expands each phase into concrete work). Server at
`https://umaserver.nanax3.xyz` is fixed and never modified; every phase ships
something playable in a browser.

Legend: **[UI]** Angular feature · **[API]** typed endpoint wrapper ·
**[PROTO]** wire-protocol core · **[PIPE]** offline pipeline (`umaFront/pipeline/`)

---

## P0 — Foundations: browser ⇄ live server loop

**Milestone: logged into the live server from a browser; home shell shows real
viewer id, wallet and user info.**

- **[PROTO]** `core/protocol/`: msgpack (`msgpackr`) · WebCrypto AES-256-CBC
  (PKCS7) with key-append framing · `HEAD` magic + u32LE header builder ·
  udid (16 random bytes, persisted) · md5 sid-salt chaining · base64 in/out.
- **[PROTO]** `uma-client.ts`: `call(endpoint, payload)` → decoded envelope;
  attaches payload boilerplate (`viewer_id, device, device_id, locale:"ENG", …`);
  tracks 42-hex `sid` rotation; maps `data_headers.result_code != 1` to typed
  errors; auto re-login on `201 SESSION_ERROR`; persists
  `viewer_id`/`auth_key`/`udid` in localStorage.
- **Layer B relay**: dev `proxy.conf` for `ng serve` and the `/g/*` forwarder in
  `src/server.ts` (prod: nginx equivalent) → `https://umaserver.nanax3.xyz`,
  browser-like UA header.
- **[API]** `tool.api.ts` (`pre_signup`, `signup`, `start_session`),
  `load.api.ts` (`load/index`), `read_info.api.ts` (announcements).
- **[UI]** `features/boot/`: title screen → signup (country list from
  `pre_signup`) or login form (existing viewer_id + auth_key) → start_session →
  load/index pipeline with loading states and error handling.
- **[UI]** `features/home/` skeleton: user info, wallets/coins, scenario banners
  from `single_mode_scenario_id_array`.
- **Acceptance:** clean-browser test → new account created on the live server,
  session established, home renders the 105-key `load/index` state; existing
  accounts log back in with stored credentials.

## P1 — Data layer: master data, localization, art

**Milestone: every name, description and icon in the UI comes from real game
data.**

- **[PIPE]** `export-master`: read-only `master.mdb` → versioned JSON:
  `text_data` split by category, `chara_data`, `support_card_data`,
  `skill_data`, `item_data`, `race`, `race_track`, `gacha_data`, story tables.
- **[PIPE]** `extract-assets`: port of `extract_race_assets.py` recipe
  (apsw hexkey on `Persistent/meta` + UnityPy) → targeted subsets: card/chara
  art (Texture2D → webp), UI icons, rarity frames. Content-addressed output
  under the relay's static `/assets/**`.
- **[PIPE]** `gen-models`: decode the 385 fixture REQ/RES pairs +
  `seeds/load_index_fresh.json` → TS interfaces in `core/api/models/`.
- **[UI]** `data/master.service.ts` (lazy JSON chunks) + `data/text.service.ts`
  (category-based localization, en first).
- **[UI]** shared card/chara rendering components (portrait, rarity frame,
  level/limit-break stars, support-card icons).
- **Acceptance:** home + roster screens show real names, art and localized text;
  types for the whole P0/P1 surface come from codegen, not hand-typed.

## P2 — Career core: the training loop

**Milestone: a full URA run (scenario 1) playable start to finish; framework
covers scenarios 2–4 (unity_cup, grand_live, trackblazer).**

- **[API]** `single-mode.api.ts`: `start`, `load`, `exec_command`,
  `check_event`, `get_choice_reward`, `gain_skills`, `continue`, `finish`,
  `change_running_style`, `factor_select` / `factor_lottery` family;
  `pre_single_mode/index` (roster + succession pick).
- **[UI]** `features/career/`:
  - career select (`pre_single_mode`): uma picker, support deck picker,
    inheritance/succession screen;
  - turn dashboard: turn counter, current stats, energy/mood, fan count,
    support-card layout on the training grounds, upcoming-race calendar;
  - training command execution (`exec_command`) with result projection;
  - event viewer (`check_event` → `get_choice_reward`): event text/art,
    choices, reward preview;
  - skill screen (`gain_skills`): skill list, points, buy flow;
  - scenario hooks abstraction (mirrors the server's Scenario pattern) so
    grand_live squares / trackblazer items / unity_cup teams slot in without
    rewriting shared screens;
  - run completion (`finish`) → result summary.
- **[UI]** in-career race scheduling handled minimally (auto/quick result) —
  the full race experience is P3.
- **Acceptance:** complete a URA career on the live server using only the
  browser; state persists across reload (`single_mode/load`).

## P3 — Races: entry + replay viewer

**Milestone: watch your race play out on a top-down course map.**

- **[API]** race endpoints: `single_mode*/race_entry`, `race_analyze`,
  `race_start`, `race_end` (replay frames), `race_out`; top-level `race/analyze`.
- **[PIPE]** course geometry: reuse `UmamusumePS/server/data/course_paths.json`
  + `race_param_define_global.json` (already extracted) → trimmed per-course
  JSON for the viewer.
- **[UI]** `render/race-viewer/`: canvas 2D top-down replay, ported from the
  proven `admin_panel/static/race-viewer.js` — runners, lane positions over
  time, skill call-outs, phases (early/mid/late/spurt), slopes/landmarks,
  playback speed controls, result + timeline breakdown.
- **[UI]** race entry screens: field listing (runners, odds, styles), running
  style pick, item usage (`reflect_item_effect`), result screen with rewards.
- **Follow-ups (same pattern):** `daily_race/*`, `practice_race/*`,
  `main_story_race/*`, `legend_race/*`.
- **Acceptance:** a career race and a daily race watched end-to-end in the
  browser with correct final placement vs. server results.
- **Stretch (post-P5 idea, not planned):** three.js 3D viewer with glTF-extracted
  chara/course models — only if the 2D viewer is deemed insufficient.

## P4 — Meta systems: account metagame

**Milestone: the out-of-career game loop is complete.**

- **[API+UI] Gacha:** `gacha/index` (banner + odds), `gacha/exec` (single/
  multi pull with animation), `gacha/get_history`, limit exchange.
- **[API+UI] Decks & cards:** support deck management
  (`support_card_deck/*`, `card/get_release_card_array`), card growth
  (`card/rarity_upgrade`, `talent_strengthen`, `skill_upgrade`),
  support-card limit break/strengthen/sell/lock.
- **[API+UI] Inheritance:** `trained_chara/load` (+ lock/memo/remove),
  succession history, factor display.
- **[API+UI] Account plumbing:** presents (`present/index, receive, receive_all`),
  missions (`mission/index, receive`), shop/exchange (`item/show_exchange,
  exchange, sell`), recovery items (`item/use_recovery_item`, `recovery/*`),
  option changes, mail/notifications from `data_headers.notifications`.
- **[API+UI] Social-lite:** profile (`user/*` basics, honors
  `honor/index/change_honor`), friends (list, follow/unfollow, search),
  user lookup.
- **Acceptance:** pull a gacha, edit a deck, redeem presents/missions, buy from
  the exchange shop — all against the live server.

## P5 — Long tail (pick by interest)

- **Story reader:** `character_story/*`, `main_story/*`, `extra_story/*` +
  extracted stills/backgrounds (`story_still` tables).
- **Audio:** jukebox (`jukebox/index`, `jukebox/*` requests) + ACB/AWB → ogg
  extraction for BGM/voice; `live_theater` concert flow as audio+still player.
- **Extended social:** circles (`circle/*`, ~44 endpoints), room match
  (`room_match/*`), practice-race partners.
- **Quality-of-life:** `campaign_walking/*`, `idle_single_mode/*` (auto-career),
  `training_challenge/*`, `note/*` (trainer notes/archive), serial codes.
- **Payment endpoints are intentionally NOT implemented** (server has
  `payment/dummy` at best; no real commerce in a private server).
- JP-only endpoints (`app/jp/features/*`) are out of scope — the live server
  answers the Global transport.

## Cross-cutting rules for every phase

1. Only implement endpoints the UI actually calls; the server NOOPs the rest.
2. Fixture REQ/RES pairs are ground truth for payload shapes — extend
   `gen-models` when a new endpoint family is added.
3. New static data/art always flows through the Layer-C pipeline, never fetched
   ad hoc at runtime (except CDN verticals **via the relay**).
4. The relay stays stateless — no game logic, no credentials, pure bytes.
5. Every phase ends with a smoke run against the **live** server, not a local
   copy of the backend.
