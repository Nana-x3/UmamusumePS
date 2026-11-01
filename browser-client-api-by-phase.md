# Browser Client — API Reference by Phase

Companion to `browser-client-phasing.md` (the plan) and
`browser-client-phase0-status.md` (P0 handoff). This file is the **contract
catalogue**: every endpoint a phase needs, with its input shape, its output
shape, the wrapper that should own it, and how confident we are in the shape.

Server: `https://umaserver.nanax3.xyz` — fixed, never modified. Everything
below is derived from the server source (`umaBack/server/app/`), the real
REQ/RES fixtures (`umaBack/server/fixtures/capture_06d26c/`), the seed blob
(`umaBack/server/data/seeds/load_index_fresh.json`), and live calls.

---

## 0. How to read this document

### 0.1 Confidence tags

Every endpoint block carries one tag. It describes the **shape**, not whether
the endpoint works.

| Tag | Meaning |
|---|---|
| **CAPTURED** | Request and/or response keys observed in a real fixture pair. Highest confidence. |
| **HANDLER** | No capture, but the server implements the endpoint and its docstring / `_ok({...})` declares the shape. Reliable, but synthesized by the server author. |
| **SYNTH** | Shape inferred from the Unity dump (`dump.cs`), the Icarus/independent client, or the handler's `payload.get()` calls. Treat field names as provisional. |
| **TBD** | No handler and no capture; server falls through to `NOOP_SUCCESS` (`data: {}`). Do not build UI on it yet. |

Captures use the endpoint names with `/` (e.g. `single_mode_team/start`),
because the fixture `endpoint` field is the wire path. The career family is
aliased across scenario prefixes (see §1.4).

### 0.2 What the wrapper layer should look like

Every endpoint gets exactly one `core/api/*.api.ts` function:

```ts
export async function someEndpoint(
  client: UmaClient,
  params: SomeRequest,
): Promise<SomeResponse> {
  const envelope = await client.call<SomeResponse>('feature/action', params);
  return envelope.data;
}
```

Rules that hold for every wrapper:

1. **Return `envelope.data`**, never the envelope. Screens do not need
   `data_headers` except for notifications/sid (handled inside `UmaClient`).
2. **Request fields are snake_case**, exactly as the server reads them.
3. **Boilerplate is added by `UmaClient`**, not by wrappers. Never put
   `viewer_id`, `device`, `locale`, `sid`, etc. in a request type.
4. **Empty request** = `client.call('x/y')` with no second argument. The
   client still sends the boilerplate.
5. **`result_code != 1` is an error.** `UmaClient` throws a typed error; the
   wrapper does not inspect `response_code`.

### 0.3 The wire envelope

```
response = {
  response_code: 1,                       // always 1 on Global
  data_headers: {
    result_code: 1,                       // 1 = OK; anything else = refusal
    viewer_id: "440168743960",
    sid:        "42-hex",                 // next request chains md5(sid + salt)
    servertime: 1784317773,
    notifications: { ... },               // unread mail / info / badges
    server_list?: { ... }                 // only on tool/start_session
  },
  data: { ... }                           // endpoint-specific
}
```

The on-the-wire body is `base64(AES-256-CBC(msgpack(envelope)) + key32)`.
The JSON in this document is the **decoded** envelope.

### 0.4 Errors

| `data_headers.result_code` | Name | Meaning | Client behaviour |
|---|---|---|---|
| `1` | OK | Success | apply `data` |
| `205` | `PARAM_ERROR` | Ordinary business refusal (not enough TP, race already played, disabled command, …) | show the refusal dialog / disable the action |
| `201` | `SESSION_ERROR` | Session/sid invalid (another client logged in, stale sid) | drop state and return to title |
| `202` | `AUTH_ERROR` | Bad credentials (transition-code password, etc.) | show credential error |

On every refusal `data` is `{}` and `response_code` stays `1`. The server logs
`RESULT <endpoint> -> <code>`.

Some endpoints return a *domain* success code inside `data` (e.g.
`single_mode/change_running_style` returns `2502` with empty data on the real
server; the client accepts it). The server here normalises those to the
standard envelope wherever it has a handler.

### 0.5 Payload boilerplate (added automatically)

```
viewer_id: string, device: 4, device_id: string, device_name: string,
graphics_device_name: string, ip_address: string, platform_os_version: string,
carrier: "", keychain: 0, locale: "ENG", button_info: "",
dmm_viewer_id: null, dmm_onetime_token: null,
steam_id: string, steam_session_ticket: string
```

`load/index` adds `adid`; `tool/start_session` adds `attestation_type` and
`device_token`; `tool/signup` adds `country`, `optin_user_birth`, `dma_state`.

### 0.6 Ids, times and types

- `viewer_id` is a 12-digit numeric string in headers and most payloads.
  `tool/signup` returns it as a **JSON number**; convert with `String(...)`.
- `trained_chara_id`, `card_id`, `chara_id`, `support_card_id`, `program_id`,
  `race_instance_id`, `skill_id`, `item_id` are numbers.
- `register_time` / `create_time` / `possess_time` are
  `"YYYY-MM-DD HH:MM:SS"` strings.
- `servertime` and `max_recovery_time` are Unix seconds (numbers).
- `reward_limit_time = 4133948399` is the "never expires" sentinel.
- Arrays that a real handler builds are always `[]`, never `null`. The
  `NOOP_SUCCESS` fallback sends `data: {}`, so **a missing key is normal for
  unimplemented endpoints** — guard with `?? []`.

---

## 1. Cross-phase protocol notes

### 1.1 Endpoint families

| Family | Phase | Note |
|---|---|---|
| `tool/*`, `load/*`, `read_info/*` | P0 | login + home blob |
| `user/change_*` | P0/P4 | profile edits |
| `pre_single_mode/*`, `single_mode/*` | P2 | career core |
| `single_mode*/race_*`, `race/analyze` | P3 | in-career races |
| `daily_race/*`, `legend_race/*`, `daily_legend_race/*`, `practice_race/*`, `main_story_race/*` | P3 | out-of-career races |
| `gacha/*`, `card/*`, `support_card/*`, `support_card_deck/*`, `trained_chara/*` | P4 | collection |
| `present/*`, `mission/*`, `item/*`, `honor/*`, `friend/*` | P4 | meta loop |
| `circle*`, `room_match/*`, `jukebox/*`, `live_theater/*`, story readers, `note/*`, `idle_single_mode/*`, `campaign_walking/*`, `training_challenge/*`, `serial_code/*` | P5 | long tail |

### 1.2 Implemented vs. aliased vs. no-op

- **262 endpoints** have a registered handler.
- **55** of those are additionally reachable through aliases in
  `dispatch.HANDLERS` (the `single_mode_team/*` family and friends).
- Everything else (**~207 paths**, including all `payment/*`) falls through to
  `NOOP_SUCCESS`, which returns `data: {}` with `result_code: 1`.
- `single_mode/*`, `single_mode_live/*`, `single_mode_team/*` and the other
  scenario prefixes share **one handler set** (`_install_scenario_routes`).
  The only wire difference is the `data_set` the scenario attaches.

So: "the endpoint exists" ≠ "the server does something". Check the tag.

### 1.3 The career scenario prefixes

| Scenario id | Name | Prefix |
|---|---|---|
| `1` | URA | `single_mode/*` |
| `2` | Unity Cup | `single_mode_team/*` |
| `3` | Grand Live | `single_mode_live/*` |
| `4` | Trackblazer | `single_mode_trackblazer/*` (aliased; some extra endpoints) |

The client stores `load/index.single_mode_scenario_id_array` and builds the
prefix from the chosen scenario. Shared verbs are identical; a response may
carry `team_data_set` (Unity Cup) or `*_data_set` (scenario-specific) instead
of / alongside the URA fields.

### 1.4 The `data_set` rule

Responses that represent the career screen carry a scenario-specific
`data_set`:

- `single_mode/load` → `trackblazer_data_set` / `live_data_set` / …
- `single_mode_team/load` → `team_data_set`

The client should render shared fields (`chara_info`, `home_info`,
`unchecked_event_array`) generically and hand the `*_data_set` to the
scenario adapter. Never assume `team_data_set` exists outside scenario 2.

### 1.5 Duplicated `*_common` blocks (server quirk)

`single_mode/start` and `single_mode/load` responses contain **both**

- flat top-level fields (`chara_info`, `home_info`, `unchecked_event_array`,
  `race_start_info`, `race_scenario`, …), and
- a nested mirror named `single_mode_start_common` / `single_mode_load_common`.

**Prefer the flat top-level fields.** They are what the server patches with
`sync_chara_info`; the nested mirror can lag (observed: `chara_info` differs
between the two blocks in the same response). The nested block is useful only
for fields the flat block omits.

---

## 2. P0 — Foundations

Milestone: logged into the live server from a browser; home shell shows real
viewer id, wallet and user info.

**Call order**

```
tool/pre_signup ──► (user picks country)
tool/signup     ──► viewer_id + auth_key        → persist
tool/start_session ──► sid + resource_version   → persist sid
load/index      ──► 105-key home state          → status = ready
read_info/index ──► announcements (optional, parallel)
```

Existing account (viewer id in `localStorage`): `start_session` → `load/index`.
Sign-out: clear viewer id + sid + state → title. The server ignores the
presented sid while `auth_enforce` is off, but the client should still chain
it (§1.1 of the status doc).

### 2.1 `tool/pre_signup` — CAPTURED + HANDLER

The only call that needs no `viewer_id`.

**Request**

```json
{}
```

**Response**

```json
{
  "attest": false,
  "nonce": "",
  "enable_steam_account": false,
  "country_list": [
    { "country": "United States", "country_type": 2 }
  ]
}
```

- `country_list` has **167** entries on the live server.
- `country_type` ∈ `{0, 1, 2}`; `2` is the normal "selectable" type.
- `attest` / `nonce` are the anti-cheat stub; always `false` / `""`.

**Wrapper:** `core/api/tool.api.ts` → `preSignup(client)` (exists).

**UI:** render `country_list` in a searchable select; store the chosen
`country` string (not the type) for signup.

### 2.2 `tool/signup` — SYNTH request / HANDLER response

Mints a fresh account. The server ignores the body; it derives everything
from `secrets`.

**Request**

```json
{
  "country": "United States",
  "optin_user_birth": 0,
  "dma_state": 0
}
```

**Response**

```json
{
  "viewer_id": 440168743960,
  "auth_key": "base64-24-bytes"
}
```

- `viewer_id` is a **number** here and a **string** everywhere else. The
  wrapper does `String(...)`.
- `auth_key` is 24 random bytes base64-encoded. Persist it; the server
  currently does not require it on every call (the live sid is the session),
  but it is the account credential.
- Side effect: the server seeds the account's `load/index` blob immediately,
  so `user/change_name` works before the first `load/index`.

**Wrapper:** `signup(client, { country, optinUserBirth: 0, dmaState: 0 })`
(exists; also calls `client.setViewerId`).

**UI:** only ever call `signUpAndStart(country)`; never fire `signUp` and
`startSession` as two independent click statements.

### 2.3 `tool/start_session` — CAPTURED

Establishes a fresh session base and returns the asset server list.

**Request**

```json
{ "attestation_type": 0, "device_token": null }
```

**Response `data`**

```json
{
  "attest": false,
  "nonce": "",
  "terms_updated": false,
  "is_tutorial": false,
  "resource_version": "10006910"
}
```

**Response `data_headers`** additionally carries:

```json
{
  "server_list": {
    "resource_server":        "assets-umamusume-en.akamaized.net/dl/vertical/",
    "resource_server_cf":     "assets-umamusume-en.akamaized.net/dl/vertical/",
    "resource_server_login":  "assets-umamusume-en.akamaized.net/dl/vertical/",
    "resource_server_ingame": "assets-umamusume-en.akamaized.net/dl/vertical/"
  }
}
```

- This is the **one** endpoint where `sid` gets a new base. Every later
  call rolls a new sid on that base.
- `is_tutorial: false` is what the server always serves (tutorial already
  considered done).
- `resource_version` is frozen at `10006910`; do not gate UI on it.

**Wrapper:** `startSession(client)` (exists; sends the two extra fields).

### 2.4 `load/index` — CAPTURED

The home blob. 105 keys on the live server.

**Request**

```json
{ "adid": "" }
```

**Response `data`** — every key, grouped by what the UI needs.

| Group | Keys |
|---|---|
| Identity / wallet | `user_info`, `coin_info`, `tp_info`, `rp_info`, `country_type`, `dma_state`, `optin_user_birth`, `parental_consent`, `add_friend_point`, `is_linkage`, `recheck_dmm_jewel` |
| Career entry | `single_mode_scenario_id_array`, `single_mode_rental_succession_num`, `single_mode_succession_free_rental_time`, `single_mode_difficulty_info_array`, `single_mode_chara_light` |
| Roster | `card_list`, `chara_list`, `trained_chara`, `trained_chara_favorite_array`, `support_card_list`, `support_card_deck_array`, `last_select_support_card_deck_id`, `piece_list`, `cloth_list`, `card_dress_array`, `release_card_array`, `directory_card_num` |
| Items / shop | `item_list`, `limited_shop_info`, `release_item_flag` |
| Home surface | `home_banner_data_array`, `home_poster_data_array`, `home_story_data_array`, `short_episode_data_array`, `talk_gallery_list`, `notice_data`, `unread_announce_id_array`, `menu_badge_info`, `login_bonus_list`, `login_trophy_info_array`, `last_information_update_time` |
| Modes | `daily_race_playing_info`, `daily_legend_race_playing_info`, `legend_race_playing_info`, `practice_race_state`, `practice_partner_chara_array`, `practice_partner_owner_info_array`, `team_stadium_race_status`, `team_stadium_user`, `stadium_race_chara_id_array`, `team_data_array`, `team_building_load_info`, `challenge_match_load_info`, `champions_info`, `campaign_walking_load_info`, `idle_single_mode_load_info`, `heroes_load_info`, `map_event_load_info`, `factor_research_load_info`, `training_challenge_exam_infos`, `training_challenge_user_info` |
| Stories | `character_story_data_list`, `main_story_data_list`, `extra_story_data_list`, `event_data_array`, `released_episode_data_array`, `story_favorite_array`, `story_event_first_flag`, `story_event_id`, `story_event_mission_list`, `story_event_roulette_coin_num` |
| Gacha / events | `gacha_banner_info`, `gacha_campaign_info_array`, `added_gacha_stock_info`, `user_campaign_info_array`, `raffle_campaign_response_data`, `valentine_campaign_received_array`, `valentine_campaign_special_received_array`, `collect_raid_login_info`, `fan_raid_first_flag`, `fan_raid_id` |
| Audio / misc | `jukebox_info`, `jukebox_request_history`, `music_list`, `new_plushie_exists`, `border_line`, `common_define`, `option_info_array`, `payment_maintenance_flag`, `payment_purchased_times_list`, `res_version`, `season_pack_info`, `rank_score`-adjacent (`ranking`), `home_position_info`, `honor_info`, `support_user_num`, `cygames_id_apply_product_flag`, `cygames_id_serial_code_reward_info_array`, `user_birth`, `user_last_checked_time_list`, `event_data_array` |

**Shapes of the keys P0 reads**

```json
{
  "user_info": {
    "viewer_id": "440168743960",
    "name": "Trainer3960",
    "honor_id": 0,
    "sex": 1,
    "tutorial_step": 1000,
    "leader_chara_id": 0,
    "leader_chara_dress_id": 0,
    "support_card_id": 0,
    "partner_chara_id": 0,
    "bonus_follow_num": 0,
    "fan": 0,
    "rank_score": 0,
    "best_team_evaluation_point": 0,
    "last_ticket_natural_recovery_time": "0000-00-00 00:00:00",
    "register_time": "2026-11-01 12:00:00",
    "create_time": "2026-11-01 12:00:00",
    "update_time": "2026-11-01 12:00:00",
    "honor_data": {},
    "name": "Trainer3960",
    "comment": "",
    "birth_day": 0
  },
  "coin_info": { "fcoin": 0, "coin": 0 },
  "tp_info":   { "current_tp": 100, "max_tp": 100, "max_recovery_time": 0 },
  "rp_info":   { "current_rp": 100, "max_rp": 100, "max_recovery_time": 0 },
  "single_mode_scenario_id_array": [1, 2, 3, 4],
  "support_card_deck_array": [
    { "deck_id": 1, "name": "Deck 1", "support_card_id_array": [0, 0, 0, 0, 0] }
  ],
  "notice_data": { "event_id": 0, "notice_title": "", "notice_text": "", "button_type": 1 },
  "menu_badge_info": {
    "new_gacha_flag": 1, "can_receive_tap_reward": 0, "present_num": 44,
    "mission_num": 4, "legend_mission_num": 0, "champions_mission_array": [],
    "training_challenge_mission_num": 1, "challenge_match_mission_num": 0,
    "team_building_mission_num": 0, "view_limited_mission_num": 220,
    "collect_raid_mission_flag": 0
  }
}
```

Notes:

- `coin_info` is the **wallet**: `fcoin` = free carats, `coin` = money.
- `tp_info.current_tp` is the career stamina pool; `use_tp` on
  `single_mode/start` spends from it.
- `tp_info.max_recovery_time` is a Unix timestamp; `0` means "full".
- `notice_data` is the login notice dialog; render only when
  `notice_title`/`notice_text` are non-empty.
- `home_banner_data_array` is usually `[]` on a fresh account; P1 fills it.

**Wrapper:** `loadIndex(client)` (exists).

### 2.5 `read_info/index` — CAPTURED

Announcements / "what's new" lists. Currently clipped to one call per login;
the server returns all categories whether or not the client asks.

**Request**

```json
{
  "add_home_story_data_array": [],
  "add_short_episode_data_array": [],
  "add_home_poster_data_array": [],
  "add_tutorial_guide_data_array": [],
  "add_released_episode_data_array": [],
  "add_talk_gallery_data_array": [],
  "add_home_banner_data_array": []
}
```

Each `add_*` array carries ids the client has already seen; empty means
"send me everything".

**Response `data`** — 7 arrays, keys drop the `add_` prefix:

```json
{
  "home_story_data_array":         [{ "id": 4 }],
  "short_episode_data_array":      [],
  "home_poster_data_array":        [],
  "tutorial_guide_data_array":     [{ "id": 1 }],
  "released_episode_data_array":   [],
  "talk_gallery_data_array":       [],
  "home_banner_data_array":        []
}
```

**Wrapper:** `readInfoIndex(client)` (exists, currently unused).

**UI:** optional. Home can ignore this endpoint in P0 and still meet
acceptance; wire it when the announcements panel exists.

### 2.6 `user/change_name` — CAPTURED request / HANDLER response

Set the trainer name. The server trims and enforces 1–16 characters.

**Request**

```json
{ "name": "Trainer3960" }
```

**Response**

```json
{ "user_info": { "...": "full UserInfo after the change" } }
```

- Wrapper returns `data.user_info`.
- The server writes the name into the stored `load/index` blob, so a reload
  shows it.

**Wrapper:** `changeName(client, name)` (exists).

**UI:** validate before calling: `name.trim().length` in `1..16`; disable the
submit button while the request is in flight.

### 2.7 `user/change_sex` — CAPTURED request / HANDLER response

**Request**

```json
{ "sex": 1 }
```

`sex` is `1` or `2`. Any other value is refused (`205`).

**Response**

```json
{ "user_info": { "...": "full UserInfo after the change" } }
```

Side effect: sets `user_info.tutorial_step = 1000` in the stored blob.

**Wrapper:** `changeSex(client, 1 | 2)` (exists).

### 2.8 P0 screen → endpoint map

| Screen / action | Endpoints |
|---|---|
| Title | — |
| Country picker | `tool/pre_signup` |
| Create account | `tool/signup` → `tool/start_session` → `load/index` |
| Log in with stored id | `tool/start_session` → `load/index` |
| Home | `load/index` (+ optional `read_info/index`) |
| Edit name | `user/change_name` |
| Edit sex | `user/change_sex` |
| Sign out | — (clear localStorage + state) |

---

## 3. P1 — Data layer

Milestone: every name, description and icon comes from real game data.

**This phase adds no gameplay endpoints.** It is the offline pipeline
(`umaFront/pipeline/`) plus read-only consumers of `load/index`. The only
live endpoint it may call is `banner_url`.

### 3.1 What the pipeline must export

| Dataset | Source | Consumer |
|---|---|---|
| Localization (`text_data` split by `category`) | `Persistent/master/master.mdb` | `data/text.service.ts` |
| Chara / card / support-card / skill / item tables | `master.mdb` | roster, deck, gacha screens |
| Race + race-track tables | `master.mdb` | P3 race entry |
| Story tables (`story_still`, episode lists) | `master.mdb` | P5 story reader |
| Card/chara art, rarity frames, UI icons | `Persistent/meta` + UnityPy | every card component |
| Course geometry | `server/data/course_paths.json` (pre-extracted) | P3 viewer |
| Race params | `server/data/race_param_define_global.json` | P3 sim/viewer |
| TS interfaces | fixtures + `load_index_fresh.json` | `core/api/models/` |

The pipeline is build-time only. The relay (`/assets/**`) serves the output;
nothing is fetched from Cygames at runtime except CDN art through the relay.

### 3.2 `banner_url` — HANDLER

Completes the home-banner contract. The server has no real destination and
returns an empty string so the banner is inert.

**Request**

```json
{ "banner_id": 1 }
```

**Response**

```json
{ "url": "" }
```

**Wrapper:** `core/api/home.api.ts` → `bannerUrl(client, bannerId)`
(to add in P1).

**UI:** if `url === ""`, the banner is decorative (no click / no navigation).

### 3.3 Pipeline output contract

The generated models are the single source of truth for P2–P5 request and
response types. Rules:

1. Generate from `load_index_fresh.json` for the home blob, and from the
   fixture pairs for everything captured.
2. Hand-write only the shapes tagged **HANDLER** / **SYNTH** here, and keep
   the hand-written file (`core/api/models/*.apitypes.ts`) separate from the
   generated one so regeneration never clobbers it.
3. Re-run `gen-models` whenever a new fixture family is added.
4. Never type a field as `unknown` if a screen reads it.

### 3.4 P1 acceptance mapping

| Acceptance clause | Data needed |
|---|---|
| Home shows real name | `user_info.name` + `text_data` fallbacks |
| Wallet shows real values | `coin_info`, `tp_info`, `rp_info` |
| Scenario banners show real art | `single_mode_scenario_id_array` + extracted scenario art |
| Roster shows real cards | `card_list`, `chara_list`, `support_card_list` + `master.mdb` names + extracted art |
| Text is localized | `text_data` keyed by category |

---

## 4. P2 — Career core

Milestone: a full URA run (scenario 1) playable start to finish; the
framework covers scenarios 2–4.

**Lifecycle**

```
pre_single_mode/index            pick trainee / deck / parents
single_mode/start                create the career
single_mode/load                 re-enter an existing career (reload)
  ┌──────────────────────────────────────────────────────────┐
  │ turn loop                                                │
  │   exec_command (training/rest/outing/infirmary)          │
  │   check_event  (story event, schedule race, choice)      │
  │   get_choice_reward (preview or commit, per event kind)  │
  │   gain_skills  (skills screen)                           │
  │   change_running_style / multi_race_reserve              │
  │   race_entry → race_analyze → race_start → race_out      │
  │     → race_end  (P3)                                     │
  │   continue (retry a lost goal race)                      │
  └──────────────────────────────────────────────────────────┘
single_mode/factor_select        post-career spark roll
single_mode/finish               bank the legacy / give up
```

### 4.1 The shared career response vocabulary

Most P2/P3 responses reuse these blocks. Learn them once.

#### `CharaInfo` — CAPTURED

```json
{
  "single_mode_chara_id": 601,
  "card_id": 100402,
  "chara_grade": 8,
  "speed": 1160, "stamina": 382, "power": 566, "wiz": 1291, "guts": 363,
  "vital": 100,
  "max_speed": 1359, "max_stamina": 1330, "max_power": 1311,
  "max_wiz": 1800, "max_guts": 1304,
  "default_max_speed": 1200, "default_max_stamina": 1200,
  "default_max_power": 1200, "default_max_wiz": 1200, "default_max_guts": 1200,
  "max_vital": 100,
  "motivation": 4,
  "fans": 187719,
  "rarity": 4,
  "race_program_id": 0,
  "reserve_race_program_id": 0,
  "race_running_style": 1,
  "is_short_race": 0,
  "proper_ground_turf": 7, "proper_ground_dirt": 4,
  "proper_running_style_nige": 7, "proper_running_style_senko": 3,
  "proper_running_style_sashi": 1, "proper_running_style_oikomi": 1,
  "proper_distance_short": 6, "proper_distance_mile": 7,
  "proper_distance_middle": 7, "proper_distance_long": 8,
  "talent_level": 5,
  "skill_array": [{ "skill_id": 110041, "level": 5 }],
  "disable_skill_id_array": [],
  "skill_tips_array": [{ "group_id": 20004, "rarity": 1, "level": 1 }],
  "support_card_array": [{ "support_card_id": 30028, "exp": 0, "limit_break_count": 0 }],
  "succession_trained_chara_id_1": 176,
  "succession_trained_chara_id_2": 220,
  "turn": 72,
  "skill_point": 1644,
  "short_cut_state": 1,
  "state": 0,
  "playing_state": 1,
  "scenario_id": 2,
  "route_id": 20,
  "start_time": "2026-07-17 12:51:13",
  "evaluation_info_array": [],
  "training_level_info_array": [],
  "nickname_id_array": [],
  "chara_effect_id_array": [],
  "route_race_id_array": [],
  "guest_outing_info_array": [],
  "skill_upgrade_info_array": []
}
```

`motivation` is 1–5 (1 = worst, 5 = best). `vital` is the current energy.

#### `HomeInfo` — CAPTURED

```json
{
  "command_info_array": [
    {
      "command_type": 1,
      "command_id": 101,
      "is_enable": 1,
      "training_partner_array": [1, 2, 4, 1035, 1053],
      "tips_event_partner_array": [],
      "params_inc_dec_info_array": [
        { "target_type": 1, "value": 39 },
        { "target_type": 3, "value": 19 },
        { "target_type": 30, "value": 14 },
        { "target_type": 10, "value": -25 }
      ],
      "failure_rate": 0,
      "level": 5
    }
  ],
  "race_entry_restriction": 0,
  "disable_command_id_array": [],
  "available_continue_num": 0,
  "available_free_continue_num": 0,
  "free_continue_num": 0,
  "free_continue_time": 0,
  "shortened_race_state": 0
}
```

`target_type` mapping used by the UI: `1` speed, `2` stamina, `3` power,
`4` guts, `5` wiz, `10` energy, `30` skill points.

#### `UncheckedEvent` — CAPTURED

```json
{
  "event_id": 201121,
  "chara_id": 0,
  "story_id": 400002120,
  "play_timing": 11,
  "event_contents_info": {
    "support_card_id": 0,
    "show_clear": 0,
    "show_clear_sort_id": 0,
    "choice_array": [
      {
        "select_index": 1,
        "receive_item_id": 0,
        "target_race_id": 0,
        "gain_select_id_index": 1,
        "select_icon": 0
      }
    ],
    "is_effected_multi_chara": false,
    "tips_training_partner_id": null
  },
  "succession_event_info": null,
  "minigame_result": null
}
```

`event_contents_info.choice_array` empty / single entry means "no real
choice" (auto-continue); two or more means render buttons.

#### `TrainingState` (the common tail)

Most mutating career calls return:

```json
{
  "chara_info": { "...": "CharaInfo" },
  "home_info": { "...": "HomeInfo" },
  "unchecked_event_array": ["...UncheckedEvent"],
  "race_condition_array": [{ "program_id": 92, "weather": 1, "ground_condition": 1 }],
  "team_data_set": null,
  "not_up_parameter_info": [],
  "not_down_parameter_info": [],
  "command_result": { "command_id": 101, "sub_id": 1, "result_state": 2 }
}
```

`team_data_set` is non-null only for scenario 2; other scenarios replace it
with their own `*_data_set`. `command_result.result_state` is the training
outcome the animation plays: `1` great, `2` normal, `3` bad (values observed
`2`; treat unknown as normal).

### 4.2 `pre_single_mode/index` — CAPTURED

The career-setup screen: trainee roster, support deck, parent picker, friend
card list.

**Request**

```json
{}
```

**Response `data`** — 6 keys:

| Key | Meaning |
|---|---|
| `succession_trained_chara_data` | parent-picker entries (other players' legacies) |
| `event_succession_trained_chara_data` | event-rental parents |
| `friend_support_card_data` | `{ summary_user_info_array, support_card_data_array }` — the friend borrow list |
| `support_card_ranking_state` | ranking/deck hints |
| `race_add_reward_info` | race reward table for the chosen scenario |
| `scenario_record_highest_score_array` | `[{ scenario_id, highest_rank_score }]` |

**Wrapper:** `core/api/career.api.ts` → `preSingleModeIndex(client)`
(to add in P2).

**UI:** the setup screen reads `succession_trained_chara_data` for the parent
picker and `friend_support_card_data.support_card_data_array` for the borrow
slot. Both are server-populated; do not fall back to the viewer's own roster
(the server deliberately injects other-account data here).

### 4.3 `pre_single_mode/friend_support_card_reload` — HANDLER

Reroll the borrow list.

**Request**

```json
{ "exclude_viewer_id_array": ["440168743960"] }
```

**Response**

```json
{
  "summary_user_info_array": [],
  "support_card_data_array": []
}
```

Both arrays are always present. When the exclusion empties the pool, the
server serves the full pool again.

**Wrapper:** `friendSupportCardReload(client, excludeViewerIds)` (to add).

### 4.4 `single_mode/start` — CAPTURED

Creates or resumes a career. **Guarded**: the same `start_chara.card_id`
returns the persisted career; a different card clears and reseeds. A
double-submit is therefore safe-ish, but the UI should still debounce.

**Request**

```json
{
  "start_chara": {
    "card_id": 100402,
    "support_card_ids": [30028, 30015, 20015, 20012, 20002],
    "friend_support_card_info": { "viewer_id": "440168743960", "support_card_id": 30010 },
    "succession_trained_chara_id_1": 176,
    "succession_trained_chara_id_2": 220,
    "rental_succession_trained_chara": {
      "viewer_id": 0, "trained_chara_id": 0,
      "is_circle_member": false, "is_event_rental": false
    },
    "scenario_id": 1,
    "selected_difficulty_info": { "difficulty_id": 0, "difficulty": 0, "is_boost": 0 },
    "select_deck_id": 10,
    "boost_story_event_id": 0,
    "boost_factor_research_event_id": 0,
    "is_play_training_challenge": false,
    "training_challenge_mode": 0
  },
  "tp_info": { "current_tp": 48, "max_tp": 100, "max_recovery_time": 1784349020 },
  "current_money": 5077280,
  "use_tp": 30,
  "current_succession_rank_point": 144
}
```

`scenario_id` selects the prefix: 1 URA, 2 Unity Cup, 3 Grand Live, 4
Trackblazer. Send the prefix accordingly (`single_mode/start`,
`single_mode_team/start`, …).

**Response `data`** — the full training state plus:

| Key | Meaning |
|---|---|
| `single_mode_start_common` | nested mirror of the state (see §1.5) |
| `chara_info` | the new career's `CharaInfo` |
| `home_info` | first turn's command grid |
| `unchecked_event_array` | opening story event(s) |
| `race_condition_array` | scheduled races |
| `race_random_program_array` | randomly drawn race programmes |
| `reserved_race_array` | multi-race agenda |
| `tp_info` | TP after `use_tp` |
| `user_item_array` | starting items |
| `add_trained_chara_array` | roster entries (rentals / parents) |
| `mission_list`, `story_event_mission_list`, `story_event_chara_bonus_list` | missions |
| `team_data_set` | non-null only for scenario 2 |

**Wrapper:** `startCareer(client, request)` (to add).

**UI:** after success, go to the turn dashboard and render `home_info`.

### 4.5 `single_mode/load` — CAPTURED

Re-enter the career. Called on every reload; also called when the player
visits career mode without a `start`.

**Request**

```json
{}
```

**Response `data`**

| Key | Meaning |
|---|---|
| `chara_info` | `CharaInfo` |
| `home_info` | `HomeInfo` |
| `unchecked_event_array` | event(s) on screen when the player quit (server re-serves them) |
| `race_start_info` | non-null when a race is mid-entry |
| `race_scenario` | replay blob when a race is mid-entry |
| `race_reward_info` | pending reward block |
| `race_condition_array` | scheduled races |
| `race_random_program_array` | drawn programmes |
| `race_history` | finished races |
| `win_saddle_id_array` | saddles won |
| `reserved_race_array` | agenda |
| `effected_factor_array` | active sparks |
| `add_trophy_info`, `trophy_reward_info` | trophies |
| `prev_chara_grade` | last grade (for the grade-up animation) |
| `race_add_reward_info` | race reward table |
| `mission_list`, `story_event_mission_list`, `story_event_chara_bonus_list` | missions |
| `start_dress_info` | outfit shown at start |
| `resume_factor_select` | non-null if the player quit on the spark screen |
| `single_mode_load_common` | nested mirror (§1.5) |
| `team_data_set` | scenario 2 only |

**Wrapper:** `loadCareer(client)` (to add).

**UI:** if `race_start_info` is non-null, resume at the race screen using
`race_scenario` (P3 viewer). If `resume_factor_select` is non-null, resume
the spark screen. Otherwise render the turn dashboard.

### 4.6 `single_mode/exec_command` — CAPTURED

The main turn action: training, rest, outing, infirmary, or a race-mandatory
turn.

**Request (training / rest / outing)**

```json
{
  "command_type": 1,
  "command_id": 101,
  "command_group_id": 0,
  "select_id": 0,
  "current_turn": 1,
  "current_vital": 100
}
```

**Request (event preview — no command)**

```json
{ "event_id": 201121, "current_turn": 5 }
```

**Command ids / types (HANDLER)**

| command | `command_type` | `command_id` | `command_group_id` |
|---|---|---|---|
| Speed training | `1` | `101` | `0` |
| Stamina training | `1` | `105` | `0` |
| Power training | `1` | `102` | `0` |
| Guts training | `1` | `103` | `0` |
| Wit training | `1` | `106` | `0` |
| Rest | `7` | `701` | `0` |
| Recreation / outing | `3` | varies | `301`, `390`, `304` |
| Infirmary | `8` | `801` | `0` |

`select_id` picks a sub-option (outing destination / rest type). For a
normal training it is `0`.

**Response** — `TrainingState`, plus:

- `command_result` tells the UI which animation to play.
- `unchecked_event_array` may contain a scenario/duel/training-failure event
  triggered by this action. **Show it before the next turn.**
- `not_up_parameter_info` / `not_down_parameter_info` describe stat changes
  that were blocked (cap reached / condition).

**Refusals:** `205` when the command is disabled this turn (mandatory race,
rest-only trip, empty infirmary) or the client's `current_turn` is stale.

**Wrapper:** `execCommand(client, request)` (to add).

### 4.7 `single_mode/check_event` — CAPTURED

Resolve the event on screen, or (with `program_id`) schedule/observe a race.

**Request**

```json
{
  "event_id": 3000,
  "choice_number": 0,
  "chara_id": 1004,
  "current_turn": 1
}
```

- `choice_number: 0` = no choice (auto event).
- `choice_number: N` = commit choice `N`.
- `chara_id` is the event's character (0 for generic).
- `program_id` present (event_id usually 0) = this turn's race setup.

**Response** — `TrainingState`. May also carry:

- `event_effected_factor_array` (`[{position, factor_info_array:[{factor_id, level}]}]`)
- `race_start_info` when a race was scheduled
- `race_condition_array`
- `not_up_parameter_info` / `not_down_parameter_info`

**Wrapper:** `checkEvent(client, request)` (to add).

### 4.8 `single_mode/get_choice_reward` — CAPTURED

Two different jobs, distinguished by `choice_number`:

1. **Preview** (no `choice_number`): fill the choice buttons with their
   win/lose rewards; applies nothing.
2. **Commit** (with `choice_number`): the server applies the choice.

Some event kinds commit through `check_event` instead (notably the duel).
Follow the event's own contract: preview via `get_choice_reward`, commit via
`check_event(event_id, choice_number)`.

**Request (preview)**

```json
{ "event_id": 201121 }
```

**Request (commit)**

```json
{ "event_id": 201121, "choice_number": 2 }
```

**Response**

```json
{
  "choice_reward_array": [
    {
      "choice_number": 1,
      "reward_info_array": [
        { "item_type": 30, "item_id": 0, "item_num": 20 }
      ]
    }
  ]
}
```

`item_type` follows the reward vocabulary (`30` = skill points, `91` = money,
`90` = carats, `51` = support card, `70` = outfit). Unknown types should be
rendered generically.

**Wrapper:** `getChoiceReward(client, request)` (to add).

### 4.9 `single_mode/gain_skills` — CAPTURED

Commit the Skills screen. The client computes the purchase locally and sends
the list; the server spends SP and persists.

**Request**

```json
{
  "current_turn": 72,
  "gain_skill_info_array": [
    { "skill_id": 200042, "level": 1 }
  ]
}
```

**Response** — `TrainingState` (chara_info now includes the new skills,
`skill_point` reduced, `support_card_array` / `team_data_set` refreshed).
Always present even if the request bought nothing.

**Wrapper:** `gainSkills(client, { currentTurn, purchases })` (to add).

**UI:** quote SP from `chara_info.skill_point` and the skill table; the
server recomputes and may refuse with `205` if the total exceeds the pool.

### 4.10 `single_mode/continue` — HANDLER

Retry a lost goal race on the same turn.

**Request**

```json
{ "current_turn": 24, "continue_type": 1 }
```

- `1` = free daily retry
- `2` = Alarm Clock item

**Response** — `TrainingState` plus refreshed `home_info`
(`available_continue_num`, `available_free_continue_num`). The client then
calls `race_start` again on the same turn.

**Refusals:** `205` when the race is not retryable or the Alarm Clock is
missing.

**Wrapper:** `continueCareer(client, { currentTurn, continueType })` (to add).

### 4.11 `single_mode/change_running_style` — HANDLER

Pick the strategy on the race screen. If this turn's race is already set up,
the server re-simulates it with the new style.

**Request**

```json
{ "program_id": 676, "running_style": 2, "current_turn": 12 }
```

`running_style`: `1` nige (front), `2` senko (pace), `3` sashi (late),
`4` oikomi (end).

**Response** — standard success envelope (`data: {}` on the current server).
The real server answers a domain `2502`; the client accepts both.

**Wrapper:** `changeRunningStyle(client, request)` (to add).

### 4.12 `single_mode/multi_race_reserve` — HANDLER

Save the "agenda" of upcoming races. The client computes the schedule and
pushes it.

**Request**

```json
{
  "deck_num": 0,
  "deck_name": "Currently Scheduled Races",
  "add_race_array": [{ "program_id": 676, "turn": 12 }],
  "cancel_race_array": []
}
```

`deck_num: 0` is the live career agenda; `>= 1` are named presets.

**Response** — success envelope (`data: {}`), persisted state.

**Wrapper:** `multiRaceReserve(client, request)` (to add).

### 4.13 `single_mode/change_short_cut` — HANDLER

Career fast-forward preference.

**Request**

```json
{ "short_cut_state": 1, "current_turn": 5 }
```

**Response** — `TrainingState` (chara_info, unchecked events, scenario
`data_set`).

**Wrapper:** `changeShortCut(client, request)` (to add).

### 4.14 `single_mode/select_succession` — HANDLER

Keep one of the two offered inspiration rolls.

**Request**

```json
{ "current_turn": 1, "selected_lottery_id": 1 }
```

**Response** — success envelope (`data: {}`). Paid when the main event is
checked.

**Wrapper:** `selectSuccession(client, request)` (to add).

### 4.15 `single_mode/minigame_end` — HANDLER

Report the crane-game result; the server serves the matching outcome story.

**Request**

```json
{ "current_turn": 5, "result_state": 2 }
```

**Response** — success envelope plus the outcome event. The exact non-turn
fields are **SYNTH/TBD**; treat the response as a generic `TrainingState`
and ignore unknown keys.

**Wrapper:** `minigameEnd(client, request)` (to add).

### 4.16 Spark screen — `factor_select` / `factor_lottery` / ordering

#### `single_mode/factor_select` — CAPTURED

Roll the post-career spark set (fires after both a failed and a completed
career, before `finish`).

**Request**

```json
{ "is_force_delete": false, "current_turn": 72, "factor_lottery_id": 0 }
```

**Response**

```json
{
  "single_mode_factor_select_common": {
    "rank_score": 2147483647,
    "rank": 98,
    "lottery_remain_num": 1,
    "lottery_count": 1,
    "factor_select_info_array": [
      {
        "lottery_id": 1,
        "factor_info_array": [
          { "factor_id": 401, "level": 0 },
          { "factor_id": 2101, "level": 0 }
        ]
      }
    ],
    "factor_relottery_info_array": []
  }
}
```

**Wrapper:** `factorSelect(client, request)` (to add).

#### `single_mode/factor_lottery` — HANDLER

Pay TP for an extra spark set. Never captured; shapes from `dump.cs`.

**Request**

```json
{ "lottery_count": 1, "tp_info": { "current_tp": 48 }, "use_tp": 10 }
```

**Response** — `{ single_mode_factor_select_common }` with refreshed
`tp_info` and `lottery_remain_num`. Refused with `205` when TP is short or
re-rolls are exhausted.

**Wrapper:** `factorLottery(client, request)` (to add).

#### `single_mode/factor_order_load` — HANDLER

Opens the spark screen (JP flow). Request `{}`, response success envelope.

#### `single_mode/factor_relottery_end` — HANDLER

Closes the re-roll screen. Request `{}`, response success envelope. The pick
itself arrives with `finish`.

### 4.17 `single_mode/finish` — CAPTURED

End the career. **Always clears it.** A completed run (reached the final
turn) becomes a legacy `trained_chara`; a give-up/delete does not.

**Request**

```json
{ "current_turn": 72, "factor_lottery_id": 0, "is_force_delete": false }
```

**Response**

```json
{ "single_mode_finish_common": { "...": "..." } }
```

`single_mode_finish_common` keys (CAPTURED):

`trained_chara`, `directory_card_array`, `directory_card_num`,
`scenario_record_array`, `scenario_record_reward_array`, `directory_ranking`,
`trained_chara_id`, `chara_info`, `love_point_info`, `reward_item_info`,
`support_card_data_array`, `limited_shop_info`, `update_user_chara_info`,
`release_item_flag`, `circle_point`, `new_chara_profile_array`,
`campaign_id_array`, `transfer_event_info`, `story_event_info`,
`difficulty_data_set`, `training_challenge_result`, `collect_raid_info`,
`fan_raid_info`, `factor_research_data_set`, `campaign_walking_gauge_info`,
`map_event_gauge_info`.

`trained_chara` is an array of the legacy `TrainedChara` records (usually one
on completion, empty on give-up). `directory_card_array` drives the results
book. `reward_item_info` is the payout summary.

**Wrapper:** `finishCareer(client, request)` (to add).

### 4.18 Unity Cup team verbs (`single_mode_team/*`)

Scenario 2 uses two extra career commands, both captured:

| Endpoint | Request | Response |
|---|---|---|
| `single_mode_team/team_edit` | `{ current_turn, team_data_array }` | `{ chara_info, team_data_set }` |
| `single_mode_team/opponent_list` | `{ current_turn }` | `{ team_data_set }` |
| `single_mode_team/team_race_analyze` | `{ current_turn, race_set_id }` | `{ analyze_mark_array }` |
| `single_mode_team/team_race_start` | `{ current_turn, team_race_set_id }` | `{ chara_info, team_data_set }` |
| `single_mode_team/team_race_out` | `{ current_turn }` | `{ chara_info, team_data_set, tmp_team_rank, unchecked_event_array }` |
| `single_mode_team/team_race_end` | `{ current_turn }` | `{ add_music, chara_info, team_data_set }` |

Expose these through a `team.api.ts` adapter; they are not part of the URA
minimal loop.

### 4.19 P2 screen → endpoint map

| Screen / action | Endpoints |
|---|---|
| Career setup | `pre_single_mode/index`, `pre_single_mode/friend_support_card_reload` |
| Start career | `single_mode/start` (scenario prefix) |
| Re-enter career | `single_mode/load` |
| Turn dashboard | render `home_info.command_info_array` |
| Train / rest / outing / infirmary | `single_mode/exec_command` |
| Event viewer | `single_mode/check_event`, `single_mode/get_choice_reward` |
| Skills | `single_mode/gain_skills` |
| Strategy pick | `single_mode/change_running_style` |
| Agenda | `single_mode/multi_race_reserve` |
| Retry lost race | `single_mode/continue` |
| Spark screen | `factor_order_load`, `factor_select`, `factor_lottery`, `factor_relottery_end`, `select_succession` |
| End career | `single_mode/finish` |
| Unity Cup team | `single_mode_team/team_edit`, `opponent_list`, `team_race_*` |

---

## 5. P3 — Races

Milestone: watch a race play out on a top-down course map; entry + replay
for career races and the out-of-career families.

### 5.1 Career race flow

```
check_event(program_id)            this turn's race is scheduled
change_running_style               pick strategy
race_entry(program_id)             paddock + field
race_analyze(program_id)           "analyze the field" rows
race_start                         -> race_start_info + race_scenario (blob)
  [client plays the blob]
race_out                           -> chara_info/home_info/events
race_end                           -> rewards + race_history
```

### 5.2 `single_mode/race_entry` — CAPTURED

**Request**

```json
{ "program_id": 676, "current_turn": 12, "event_id": 0 }
```

**Response** — `{ chara_info, home_info, race_start_info, team_data_set,
unchecked_event_array }`.

`race_start_info` is the paddock view:

```json
{
  "program_id": 676,
  "random_seed": 223992235,
  "season": 2,
  "weather": 2,
  "ground_condition": 1,
  "race_horse_data": [ "...RaceHorseData (47 fields)" ],
  "continue_num": 0,
  "is_force_running_style": 0
}
```

**Wrapper:** `raceEntry(client, request)` (to add).

### 5.3 `single_mode/race_analyze` (alias `race/analyze`) — HANDLER

**Request**

```json
{ "program_id": 676, "current_turn": 12 }
```

**Response**

```json
{ "race_horse_data_array": ["...RaceHorseData"] }
```

Exactly one field. An unresolved/mismatched programme returns an **empty
array**, not `205` — treat it as "no data yet".

**Wrapper:** `raceAnalyze(client, request)` (to add).

### 5.4 `single_mode/race_start` — CAPTURED

**Request**

```json
{ "current_turn": 12, "is_short": false }
```

**Response**

```json
{
  "race_start_info": { "...": "same shape as race_entry's" },
  "race_scenario": "H4sIAAAAAAAA..."
}
```

### 5.5 `single_mode/race_out` — CAPTURED

After the replay. **Request** `{ "current_turn": 12 }`.

**Response** — `{ chara_info, home_info, team_data_set, unchecked_event_array }`.

This is where post-race story events arrive; show them before the results.

### 5.6 `single_mode/race_end` — CAPTURED

**Request** `{ "current_turn": 12 }`.

**Response** — the reward tail:

```json
{
  "race_reward_info": {
    "result_rank": 1,
    "result_time": 679111,
    "race_reward": [{ "item_type": 91, "item_id": 59, "item_num": 200 }],
    "race_reward_bonus": [],
    "gained_fans": 1463,
    "campaign_id_array": [],
    "race_reward_plus_bonus": [],
    "race_reward_bonus_win": []
  },
  "chara_info": { "...": "CharaInfo" },
  "home_info": { "...": "HomeInfo" },
  "add_music": [],
  "race_history": [
    { "turn": 12, "program_id": 676, "weather": 2, "ground_condition": 1,
      "running_style": 1, "result_rank": 1, "frame_order": 7, "npc_count": 8 }
  ],
  "win_saddle_id_array": [33],
  "race_condition_array": ["...RaceCondition"],
  "add_trophy_info": null,
  "trophy_reward_info": null,
  "reward_summary_info": { "...RewardSummaryInfo" },
  "race_add_reward_info": null,
  "team_data_set": null
}
```

**Wrapper:** `raceEnd(client, request)` (to add).

### 5.7 `RaceHorseData` — CAPTURED (47 fields)

```json
{
  "frame_order": 4,
  "viewer_id": "440168743960",
  "trainer_name": "Trainer0002",
  "owner_viewer_id": 0,
  "owner_trainer_name": "",
  "single_mode_chara_id": 601,
  "trained_chara_id": 0,
  "nickname_id": 0,
  "chara_id": 1004,
  "card_id": 100402,
  "mob_id": 0,
  "rarity": 4,
  "talent_level": 5,
  "skill_array": [{ "skill_id": 110041, "level": 2 }],
  "stamina": 220, "speed": 476, "pow": 301, "guts": 184, "wiz": 551,
  "running_style": 1,
  "race_dress_id": 100430,
  "chara_color_type": 0,
  "npc_type": 11,
  "final_grade": 7,
  "popularity": 1,
  "popularity_mark_rank_array": [1, 1, 1],
  "proper_distance_short": 6, "proper_distance_mile": 7,
  "proper_distance_middle": 7, "proper_distance_long": 7,
  "proper_running_style_nige": 7, "proper_running_style_senko": 3,
  "proper_running_style_sashi": 1, "proper_running_style_oikomi": 1,
  "proper_ground_turf": 7, "proper_ground_dirt": 4,
  "motivation": 5,
  "win_saddle_id_array": [33],
  "race_result_array": ["...RaceResult"],
  "team_id": 0, "team_member_id": 0, "team_rank": 0,
  "single_mode_win_count": 2,
  "fan_count": 15814,
  "item_id_array": [],
  "motivation_change_flag": 0,
  "frame_order_change_flag": 0
}
```

`RaceResult` entry (inside `race_result_array`):

```json
{
  "viewer_id": "440168743960",
  "single_mode_chara_id": 601,
  "race_num": 1, "turn": 12, "program_id": 676, "frame_order": 7,
  "weather": 2, "ground_condition": 1, "running_style": 1,
  "popularity": 1, "result_rank": 1, "result_time": 679111,
  "bashin_diff": 14841, "bashin_diff_from_top": 0,
  "skill_activate_count": 0, "start_dash_state": 0,
  "motivation": 5, "is_excitement": 0, "is_running_alone": 1,
  "last_straight_line_rank": 1, "auto_continue_num": 0, "state": 1
}
```

### 5.8 `race_scenario` blob — CAPTURED + handler

`race_scenario` is **not** msgpack and **not** plain base64 JSON:

```
race_scenario = base64( gzip( RaceSimulateData binary ) )
```

Decoded header bytes start `1f 8b 08` (gzip); after gunzip the first 4 bytes
are the int32 header length. The layout, from
`umaBack/server/app/simulation/scenario_format.py`:

```
i32   header_len
bytes header  (int32 Version)
f32   distance_diff_max
i32   horse_num
i32   horse_frame_size      // 4 + horse_num * 14
i32   horse_result_size     // 31
i32   pad1_len ; bytes pad1 // usually 0

i32   frame_count
i32   frame_size            // 4 + horse_num * horse_frame_size
repeat frame_count:
  f32 time
  repeat horse_num:                      // 14 bytes each
    f32 distance
    i16 lane_position   (lane * 100)
    i16 speed           (speed * 100)
    i16 hp
    u8  temptation_mode
    i8  block_front_horse_index          // -1 = none
i32   pad2_len ; bytes pad2  // usually 0

repeat horse_num:                        // 31 bytes each
  i32 finish_order                       // 0-based
  f32 finish_time
  f32 finish_diff_time
  f32 start_delay_time
  u8  guts_order
  u8  wiz_order
  f32 last_spurt_start_distance
  u8  running_style
  i32 defeat
  f32 finish_time_raw

i32   _reserved
i32   event_count
repeat event_count:
  u16 length
  f32 time
  u8  type
  u8  param_count
  i32 params[param_count]
```

Client-side decoder target: `core/render/race-scenario.ts`, producing
`{ distanceDiffMax, horseNum, frames[], results[], events[] }`. The frame
slots are ordered by **physical gate**, not roster order; map to runners via
`RaceHorseData.frame_order`.

**UI:** port `umaBack/admin_panel/static/race-viewer.js` (canvas 2D). It
already consumes this decoded structure and handles lane interpolation,
phases, skill call-outs and the results timeline.

### 5.9 Daily races — `daily_race/*` (CAPTURED/HANDLER)

| Endpoint | Request | Response |
|---|---|---|
| `daily_race/index` | `{}` | `{ daily_race_record_array:[{daily_race_id,is_cleared,is_played}], purchase_num, subscription_is_valid, last_start_info }` |
| `daily_race/race_entry` | `{ daily_race_id, trained_chara_id }` | `{ race_horse_data_array, season, weather, ground_condition, random_seed, race_instance_id, state:1, trained_chara_id }` |
| `daily_race/race_start` | `{ running_style }` | `{ race_scenario, state:4, running_style }` |
| `daily_race/reflect_item_effect` | `{ item_id_array }` | `{ race_horse_data_array }` |
| `daily_race/replay_check` | `{}` | `{ rank, first_clear_reward_array, drop_reward_array, victory_reward_array, reward_summary_info, state, add_trophy_info, trophy_reward_info, limited_shop_info, campaign_walking_gauge_info, factor_research_gauge_info }` |
| `daily_race/pre_replay_check` | `{}` | `{ state }` |
| `daily_race/reset` | `{}` | success envelope |
| `daily_race/resume` | `{}` | the pending paddock + `race_scenario` |
| `daily_race/get_reward_list` | `{ daily_race_id }` | `{ reward_array }` |
| `daily_race/recovery_ticket` | `{}` | `{ coin_info, reward_summary_info, purchase_num }` |
| `daily_race_skip/race_skip` | `{ daily_race_id, trained_chara_id, running_style, race_skip_count }` | `{ race_reward_array, item_info_array, limited_shop_info, campaign_walking_gauge_info, factor_research_gauge_info }` |

`race_entry` refuses with an "already played" style result when the ticket
item (96) count is below the row's `cost_num`. `daily_race/race_start` does
**not** re-send the field — the client already holds `race_entry`'s data.

### 5.10 Legend races — `legend_race/*` and `daily_legend_race/*`

`legend_race/*` (owned, farmable list):

| Endpoint | Request | Response |
|---|---|---|
| `legend_race/index` | `{}` | `{ legend_race_record_array, purchase_num, update_item_array, legend_race_mission_num }` |
| `legend_race/race_entry` | `{ legend_race_id, trained_chara_id }` | same paddock shape as daily |
| `legend_race/race_start` | `{ running_style }` | `{ race_scenario, state, running_style }` |
| `legend_race/reflect_item_effect` | `{ item_id_array }` | success envelope (paddock may refresh) |
| `legend_race/replay_check` | `{}` | `{ rank, first_clear_reward_array, drop_reward_array, victory_reward_array, reward_summary_info, state, add_trophy_info, trophy_reward_info, limited_shop_info, campaign_walking_gauge_info, factor_research_gauge_info }` |
| `legend_race/reset` | `{}` | `{ state }` |
| `legend_race/resume` | `{}` | `{ race_horse_data_array, season, weather, ground_condition, random_seed, race_instance_id, race_scenario, state, purchase_num, is_cleared }` |
| `legend_race/recovery_ticket` | `{}` | `{ coin_info, reward_summary_info, purchase_num }` |
| `legend_race/get_reward_list` | `{ legend_race_id }` | `{ reward_array }` |

`daily_legend_race/*` is the permanent daily boss list. Same verbs, keyed by
`daily_legend_race_id`; `index` returns
`{ daily_legend_race_record_array, update_item_array, last_start_info }` where
each record is `{ daily_legend_race_id, is_cleared, is_played, boss_data }`
and `boss_data` is a full 47-field `RaceHorseData`. Entry is gated on the
legend ticket (item 168): one entry per daily reset across the whole list.

### 5.11 Practice races — `practice_race/*` (HANDLER)

| Endpoint | Request | Response |
|---|---|---|
| `practice_race/index` | `{}` | `{ state, practice_race_id }` |
| `practice_race/race_start` | `{ race_instance_id }` | `{ trained_chara_array, race_horse_data_array, entry_info_array, season, weather, ground_condition, random_seed, race_instance_id }` |
| `practice_race/race_end` | `{ is_save, overwrite_race_id }` | `{ state }` |
| `practice_race/race_replay` | `{ practice_race_id }` | saved replay |
| `practice_race/change_favorite_race` | `{ practice_race_id, is_favorite }` | `{ practice_race_id, is_favorite }` |
| `practice_race/get_saved_race_list` | `{}` | `{ saved_race_array }` |
| `practice_race/delete_race` | `{ practice_race_id }` | `{ state }` |
| `practice_race/get_preset_array` / `save_preset` / `change_preset_name` | preset CRUD | `{ preset_info_array }` / `{ preset_info }` |
| `practice_race/get_partner_info` | `{ partner_id, register_time }` | `{ practice_partner_info, practice_partner_owner_info }` |
| `practice_race/search_partner` | `{}` | `{ circle_user_partner_chara_array, recommend_partner_chara_array, practice_partner_owner_info_array }` |
| `practice_race/save_partner` / `delete_partner` / `create_partner_id` / `get_partner_id` / `used_history` | partner CRUD | partner records |
| `practice_race/get_follow_user_data` | `{}` | follow-user data |

`race_start` is the practice analogue of the daily flow; the response carries
the field directly (no separate `race_entry` in this family).

### 5.12 Main-story races — `main_story_race/*` (HANDLER)

| Endpoint | Request | Response |
|---|---|---|
| `main_story_race/get_entry_list` | `{ episode_id }` | `{ entry_chara_array }` |
| `main_story_race/get_race_table` | `{ episode_id, trained_chara_id }` | `{ race_horse_data }` |
| `main_story_race/race_start` | `{ episode_id, trained_chara_id, running_style, season, weather, ground_condition }` | `{ race_result_info, running_style, is_match_gimmick }` |
| `main_story_race/race_end` | `{ episode_id }` | `{ main_story_data_list, reward_array, reward_summary_info }` |

### 5.13 P3 screen → endpoint map

| Screen / action | Endpoints |
|---|---|
| Career race entry | `single_mode/race_entry`, `single_mode/race_analyze` |
| Career race replay | `single_mode/race_start` (blob) |
| Career post-race | `single_mode/race_out`, `single_mode/race_end` |
| Strategy pick | `single_mode/change_running_style` |
| Race retry | `single_mode/continue` |
| Daily race | `daily_race/*` |
| Legend race | `legend_race/*`, `daily_legend_race/*` |
| Practice race | `practice_race/*` |
| Story race | `main_story_race/*` |
| Replay viewer | decode `race_scenario` (§5.8) |

---

## 6. P4 — Meta systems

Milestone: the out-of-career loop is complete.

### 6.1 Gacha

#### `gacha/index` — HANDLER

**Request** `{}`.

**Response**

```json
{
  "gacha_info_list": [
    {
      "id": 30110,
      "is_daily_draw_end": 0,
      "prize_selected_card_type": 0,
      "prize_selected_card_id": 0,
      "is_campaign_draw_enable_single": 0,
      "is_campaign_draw_enable_multi": 0,
      "remain_stock_num_single": 0,
      "remain_stock_num_multi": 0,
      "web_text": ""
    }
  ],
  "limit_item_info": {
    "expired_limit_item_list": [],
    "limit_item_list": [{ "gacha_id": 30110, "num": 0, "converted_item_num": 0 }],
    "reward_summary_info": null
  }
}
```

The server lists every banner with a card pool (~132), not just the live
ones. `limit_item_info.limit_item_list` is the exchange-point counter.

#### `gacha/exec` — HANDLER

**Request**

```json
{ "gacha_id": 30110, "draw_num": 10, "item_id": 0, "draw_guarantee_card_id": 0 }
```

- `draw_num` 1 or 10.
- `item_id: 0` = pay carats; a ticket item id = ticket draw.
- `draw_guarantee_card_id` for the "choose your guaranteed" banner.

**Response**

```json
{
  "gacha_result_list": [
    {
      "card_id": 100402, "card_type": 1, "rarity": 3,
      "additional_piece_num": 0, "piece_id": 0,
      "convert_common_item_num": 0, "win_prize": 0
    }
  ],
  "bonus_item_array": [],
  "reward_summary_info": { "...RewardSummaryInfo" },
  "item_list": [],
  "coin_info": { "coin": 0, "fcoin": 0 },
  "limit_item_info": { "gacha_id": 30110, "num": 10, "converted_item_num": 0 }
}
```

`gacha_result_list` entry is the 10-field `GachaResultData`. `card_type`
`1` = trainee, `2` = support card.

#### `gacha/limit_exchange` — HANDLER

**Request**

```json
{ "gacha_id": 30110, "card_type": 1, "card_id": 100402, "current_num": 10 }
```

**Response** — `{ exchange_result, reward_summary_info, limit_item_info }`.

#### `gacha/get_history` — HANDLER

**Request** `{}`.

**Response** `{ gacha_exec_history_array, gacha_reward_history_array }` — both
flat, newest-first, empty (not null) for a fresh account.

#### `gacha/get_prize_history` / `gacha/select_prize` — HANDLER

- `get_prize_history` `{}` → `{ prize_history_array: [] }` (nothing awards
  prizes on this server).
- `select_prize` `{ gacha_id, card_type, card_id }` → success envelope.

**Wrapper:** `core/api/gacha.api.ts` (to add in P4).

### 6.2 Cards and support cards

#### Trainee cards — `card/*` (HANDLER)

| Endpoint | Request | Response |
|---|---|---|
| `card/get_release_card_array` | `{}` | `{ release_card_array }` (96 ids on a fresh account) |
| `card/rarity_upgrade` | `{ card_id, now_rarity, new_rarity }` | `{ card_data, piece_data, reward_result_info }` |
| `card/talent_strengthen` | `{ card_id, talent_level, new_talent_level }` | `{ card_data, item_data_array }` |
| `card/skill_upgrade` | `{ card_id, skill_id, skill_level, new_skill_level }` | `{ card_data, item_data_array }` |
| `card/unlock` | `{ card_id }` | `{ reward_summary_info, piece_data }` |
| `card/sell_piece` | `{ sell_piece_data_array:[{piece_id,piece_num}] }` | `{ reward_summary_info, piece_data }` |
| `card/get_card_event_skill` | `{ card_id }` | `{ event_skill_list }` |

#### Support cards — `support_card/*` (HANDLER)

| Endpoint | Request | Response |
|---|---|---|
| `support_card/change_lock` | `{ support_card_id, lock_flag }` | `{ support_card_id, is_locked }` |
| `support_card/limit_break` | `{ support_card_id, material_support_card_num }` | `{ support_card_data }` |
| `support_card/limit_break_item` | `{ support_card_id, limit_break_item_id, limit_break_count }` | `{ support_card_data, item_data_array }` |
| `support_card/strengthen` | `{ support_card_id, use_money, use_global_exp }` | `{ support_card_data, item_data_array }` |
| `support_card/sell` | `{ sell_support_card_info_array }` | `{ reward_summary_info, reward_info_array }` |
| `support_card/get_support_card_event_skill` | `{ support_card_id }` | event skills |

#### Decks — `support_card_deck/*` (HANDLER)

| Endpoint | Request | Response |
|---|---|---|
| `support_card_deck/change_party` | `{ support_card_deck_array:[{deck_id,name,support_card_id_array:[5]}] }` | echoes the **full array** as `{ support_card_deck_array }` |
| `support_card_deck/change_name` | `{ deck_id, name }` | `{ support_card_deck }` — **single** deck, not an array |

`change_party` requires the full deck array; sending only the edited deck
will drop the others. `name` is trimmed, max length is enforced.

### 6.3 Trained charas and inheritance

| Endpoint | Request | Response |
|---|---|---|
| `trained_chara/load` | `{}` | `{ trained_chara_array, trained_chara_favorite_array, room_match_entry_chara_id_array }` |
| `trained_chara/change_lock_multi` | `{ trained_chara_id_array, lock_flag }` | success envelope |
| `trained_chara/change_memo` | `{ trained_chara_id, memo }` | success envelope |
| `trained_chara/change_nickname` | `{ trained_chara_id, nickname_id }` | success envelope |
| `trained_chara/remove` | `{ trained_chara_id_array }` | success envelope |
| `trained_chara/get_succession_history_array` | `{ target_trained_chara_id }` | succession history |

`TrainedChara` keys are listed in Appendix B. `factor_info_array` and
`factor_extend_array` are the spark display; `succession_chara_array` is the
parent chain.

### 6.4 Presents and missions

#### `present/index` — HANDLER

**Request**

```json
{
  "category_filter_type": [],
  "time_filter_type": 0,
  "offset": 0,
  "limit": 100,
  "is_asc": false
}
```

**Response**

```json
{
  "present_array": [
    {
      "present_id": 1,
      "state": 0,
      "reward_type": 90,
      "reward_id": 0,
      "reward_count": 1500,
      "message_id": 0,
      "message_param_value_1": 0,
      "message_param_value_2": 0,
      "message_param_value_3": 0,
      "message_param_value_4": 0,
      "reward_limit_time": 4133948399,
      "receive_time": "0000-00-00 00:00:00",
      "create_time": "2026-11-01 12:00:00",
      "free_message": ""
    }
  ],
  "no_receive_present_num": {
    "no_time_limit_present_num": 1,
    "time_limit_present_num": 0
  }
}
```

`reward_type` routing (used by the UI to pick an icon):
`90` carats, `51` support card, `70` outfit, `91` money, others = items.

`present/receive` `{ present_id }` or `{ present_id_array }`;
`present/receive_all` `{}` (idempotent). Both return the reward summary
shape the UI already knows.

#### `mission/index` — HANDLER

**Request** `{}`.

**Response**

```json
{
  "mission_list": [
    {
      "mission_id": 1,
      "exec_count": 0,
      "mission_status": 0,
      "mission_type": 1,
      "event_id": 0
    }
  ]
}
```

`mission_status`: `0` in progress, `1` claimable, `2` claimed (client reads
it this way; verify against a real account before relying on the exact
integers).

#### `mission/receive` — HANDLER

**Request** `{ "mission_id_array": [1, 2] }`.

**Response** `{ reward_summary_info, updated_mission_array }`. Entries in
`updated_mission_array` carry `condition_type` instead of the last two
`mission/index` fields.

### 6.5 Shop and items

| Endpoint | Request | Response |
|---|---|---|
| `item/show_exchange` | `{}` | `{ limit_list, disabled_id_array, release_id_array, limited_shop_info, limited_goods_info_array, new_aniv_shop_flag, check_aniv_shop_time_latest }` |
| `item/exchange` | `{ exchange_id, count }` | `{ reward_summary_info, coin_info, use_item_info }` |
| `item/exchange_multi` | `{ exchange_item_info_array }` | `{ reward_summary_info, coin_info, use_item_info_array }` |
| `item/exchangeAddFrame` | `{ exchange_id, count }` | `{ updated_user_info, use_item_info, limited_shop_info }` |
| `item/sell` | `{ item_id, count }` | `{ reward_summary_info, use_item_info }` |
| `item/use_recovery_item` | `{ item_id, item_num, client_own_num }` | `{ tp_info, rp_info }` |
| `item/check_aniv_shop` | `{}` | success envelope |
| `item/manual_close` | `{}` | success envelope |

`item/use_recovery_item` (CAPTURED) returns the pool it touched and `null`
for the untouched one — e.g. a TP item returns `{ tp_info:{...}, rp_info:null }`.
The UI must not read the null side.

### 6.6 Profile, honors and friends

#### Profile (`user/*`) — HANDLER

| Endpoint | Request | Response |
|---|---|---|
| `user/change_name` | `{ name }` | `{ user_info }` |
| `user/change_sex` | `{ sex: 1\|2 }` | `{ user_info }` |
| `user/change_comment` | `{ comment }` | success envelope |
| `user/set_birth_day` | `{ birth_day }` | success envelope |
| `user/change_leader_card` | `{ card_id }` | success envelope |
| `user/change_support_card` | `{ support_card_id }` | success envelope |
| `user/change_card_dress` | `{ card_id, dress_id }` | success envelope |
| `user/reset_card_dress` / `user/reset_all_card_dress` | `{ card_id? }` | success envelope |
| `user/change_favorite_character` | `{ set_position_info }` | `{ home_position_info }` |
| `user/change_story_favorite` | `{ story_id_array }` | `{ story_favorite_array }` |
| `user/change_dma_state` | `{ target_viewer_id, dma_state }` | success envelope |
| `user/change_practice_partner` | `{ trained_chara_id }` | success envelope |
| `user/get_profile_info` | `{}` | `{ voice_num, act_num, good_end_num, team_stadium_win_count, single_mode_play_count, rank_score, chara_event_num, support_event_num, scenario_event_num, home_event_num, main_story_num, chara_story_num, highest_rank_score }` |
| `user/get_profile_card_info` | `{}` | `{ profile_card_info, image_file_status, image_file_url, image_unique_id }` |
| `user/set_profile_card_info` | `{ profile_card_info, trained_chara_id, honor_id }` | success envelope |
| `user/get_trophy_info` | `{}` | `{ user_trophy_info_array, last_checked_time }` |
| `user/get_trophy_detail` | `{ trophy_id }` | `{ user_trophy_info }` |

#### Honors — `honor/*` — HANDLER

`honor/index` `{}` → `{ honor_list, last_checked_time, mission_list,
story_event_mission_list }`.
`honor/change_honor` `{ honor_id }` → success envelope.

#### Friends — `friend/*` — HANDLER

| Endpoint | Request | Response |
|---|---|---|
| `friend/index` | `{}` | friend list (server-wide as of the current build) |
| `friend/search` | `{ friend_viewer_id }` | `{ friend_info, user_info_summary, practice_partner_info, directory_card_array, support_card_data, follower_num, own_follow_num, enable_circle_scout }` |
| `friend/simple_search` | `{}` | `{ friend_info, user_info_summary, user_info_summary_list }` |
| `friend/follow` | `{ friend_viewer_id }` | `{ friend_data }` |
| `friend/un_follow` | `{ friend_viewer_id }` | `{ friend_data }` |
| `friend/un_follow_multi` | `{ friend_viewer_id_array }` | `{ friend_data_array }` |
| `friend/un_follower` / `friend/un_follower_multi` | viewer id / array | `{ friend_data }` / `{ friend_data_array }` |
| `friend/renew_recommend_list` | `{}` | `{ recommend_list, user_info_summary_list }` |
| `friend/get_team_stadium_team_data` | `{ viewer_id }` | `{ team_data_array, trained_chara_array, team_evaluation_point }` |
| `friend/load` | `{}` | friend screen blob |

### 6.7 Story events — `story_event/*` — HANDLER

| Endpoint | Request | Response |
|---|---|---|
| `story_event/index` | `{}` | `{ event_id, event_user_info, mission_list, story_data_list, new_story_id_list, first_access_flag }` |
| `story_event/story_clear` | `{ episode_id }` | `{ story_data, reward_array, reward_summary_info, new_story_id_list, add_music_array }` |
| `story_event/receive_mission` | `{ mission_id_array }` | `{ reward_summary_info, updated_mission_array, add_event_point, add_roulette_coin_num, new_story_id_list, get_all_point_reward }` |
| `story_event/roulette` | `{}` | roulette state |
| `story_event/roulette_change_sheet` | `{}` | `{ change_sheet_num, change_roulette_reward_list }` |
| `story_event/roulette_exec` | `{ continuous_setting }` | `{ order_list, reward_summary_info, roulette_reward_list, new_bingo_line_array, bingo_reward_list, change_sheet_num, change_roulette_reward_list, roulette_exec_count, roulette_stop_type }` |
| `story_event/announce` | `{}` | `{ content }` |

### 6.8 P4 screen → endpoint map

| Screen / action | Endpoints |
|---|---|
| Gacha | `gacha/index`, `gacha/exec`, `gacha/get_history`, `gacha/limit_exchange` |
| Card list / growth | `load/index` roster + `card/*`, `support_card/*` |
| Deck editor | `support_card_deck/change_party`, `change_name` |
| Inheritance | `trained_chara/load`, lock/memo/remove, succession history |
| Presents | `present/index`, `receive`, `receive_all`, `history` |
| Missions | `mission/index`, `mission/receive`, `honor/index` |
| Shop | `item/show_exchange`, `item/exchange*`, `item/sell` |
| Recovery | `item/use_recovery_item` |
| Profile | `user/*`, `honor/*` |
| Friends | `friend/*` |

---

## 7. P5 — Long tail

Pick by interest; each family is independent. Full endpoint lists live in the
research index; this section gives the contracts the UI will actually use.

### 7.1 Story readers

| Endpoint | Request | Response |
|---|---|---|
| `character_story/first_clear` | `{ episode_id }` | `{ character_story_data, reward_array, reward_summary_info, release_item_flag }` |
| `main_story/first_clear` | `{ episode_id }` | `{ main_story_data, reward_array, reward_summary_info, add_music_array, release_item_flag }` |
| `extra_story/first_clear` | `{ episode_id }` | `{ extra_story_data, reward_array, reward_summary_info, add_music_array }` |

Episode lists come from `load/index` (`character_story_data_list`,
`main_story_data_list`, `extra_story_data_list`) and `read_info/index`.
Story text/stills come from the P1 pipeline.

### 7.2 Audio — jukebox and live theater

| Endpoint | Request | Response |
|---|---|---|
| `jukebox/index` | `{}` | `{ request_history, like_count, summary_user_info, is_liked }` |
| `jukebox/play_user_request` | `{ music_id, music_size }` | `{ request_id }` |
| `jukebox/history` | `{}` | `{ like_array, latest_request_history, request_history_array, summary_user_info_array }` |
| `jukebox/exec_like` | `{ request_id, request_viewer_id }` | success envelope |
| `jukebox/change_play_music` / `change_random_request` / `change_user_request` | jukebox settings | success envelope |
| `jukebox/draw_random_request` | `{}` | `{ request_history, next_random_request_time, add_music_array }` |
| `live_theater/index` | `{}` | `{ live_theater_save_info_array, live_theater_last_checked_time }` |
| `live_theater/live_start` | `{ live_theater_save_info }` | `{ live_theater_save_info }` |
| `live_theater/performers_preset_index` | `{}` | `{ preset_array }` |
| `live_theater/performers_preset_update` | `{ preset }` | success envelope |

Audio files themselves are P1 extraction work (ACB/AWB → ogg).

### 7.3 Circles and room match

Counts: `circle/*` ~13, `circle_chat/*` 6, `circle_user/*` 16,
`circle_item_request/*` 4, `room_match/*` 27.

Core circle verbs:

| Endpoint | Request | Response |
|---|---|---|
| `circle/index` / `circle/list` | `{}` | circle list / own circle |
| `circle/detail` | `{ circle_id }` | circle detail |
| `circle/make` | `{ name, comment, join_style, policy }` | `{ circle_info, circle_user }` |
| `circle/update` | `{ name?, comment?, join_style?, policy? }` | `{ circle_info }` |
| `circle/break_up` / `circle/leave` | `{}` | `{ circle_user }` |
| `circle/check_join` | `{}` | `{ is_join_circle }` |
| `circle/conditional_search` | `{ keyword, join_style, member_num, policy }` | circle list |
| `circle/get_ranking_top` | `{}` | `{ circle_info_array, leader_info_array, circle_ranking_array, is_calculate }` |
| `circle_chat/polling` | `{}` | `{ circle_chat_message_array, circle_chat_user_array, circle_item_request_array, circle_item_donate_array, room_match_info_array, circle_post_partner_array, chat_polling_interval }` |
| `circle_chat/send_message` | `{ message }` | success envelope |
| `circle_chat/send_stamp` | `{ stamp_id }` | success envelope |

Room match core flow:

```
room_match/index            join_watch_room_num
room_match/create_room      -> room_info
room_match/entry_room       { room_id, entry_chara_array }
room_match/race_start       { room_id } -> race_scenario + field
room_match/race_end_result  { room_id, is_save_result, ... }
room_match/get_saved_race_result  -> saved replay
```

### 7.4 Quality-of-life

| Family | Endpoints | Notes |
|---|---|---|
| `campaign_walking/*` | `index`, `go_walking`, `check_result` | walking gauge; rewards |
| `idle_single_mode/*` | `status`, `pre_start`, `start`, `check_progress_log`, `result`, `end`, `multi_race_reserve_deck` | auto-career; `/end` refuses with `205` until the timer is ready |
| `training_challenge/*` | `index`, `exam_select`, `get_ranking` | exam/ranking |
| `note/*` | `index`, `trainer_note`, `get_*`, `save_*`, `use_gallery_key` | archive/notes |
| `serial_code/register` | `{ serial_code }` → `{ reward_array, campaign_name }` | code redemption |

### 7.5 Explicitly out of scope

- **Payment** (`payment/*`): not implemented; no commerce in a private
  server.
- **JP-only** (`app/jp/features/*`): the live server answers the Global
  transport.
- **`account/*` transition codes**: optional account-linking; only needed if
  the browser client supports account transfer.

---

## 8. Appendix A — endpoint → phase → wrapper matrix

`W` = wrapper target. `✔` = wrapper exists. `–` = not needed yet.

| Endpoint | Phase | Wrapper | Confidence |
|---|---|---|---|
| `tool/pre_signup` | P0 | `tool.api.ts` ✔ | CAPTURED |
| `tool/signup` | P0 | `tool.api.ts` ✔ | HANDLER / SYNTH req |
| `tool/start_session` | P0 | `tool.api.ts` ✔ | CAPTURED |
| `load/index` | P0 | `load.api.ts` ✔ | CAPTURED |
| `read_info/index` | P0 | `read_info.api.ts` ✔ | CAPTURED |
| `user/change_name` | P0 | `user.api.ts` ✔ | CAPTURED |
| `user/change_sex` | P0 | `user.api.ts` ✔ | CAPTURED |
| `banner_url` | P1 | `home.api.ts` – | HANDLER |
| `pre_single_mode/index` | P2 | `career.api.ts` – | CAPTURED |
| `pre_single_mode/friend_support_card_reload` | P2 | `career.api.ts` – | HANDLER |
| `single_mode/start` | P2 | `career.api.ts` – | CAPTURED |
| `single_mode/load` | P2 | `career.api.ts` – | CAPTURED |
| `single_mode/exec_command` | P2 | `career.api.ts` – | CAPTURED |
| `single_mode/check_event` | P2 | `career.api.ts` – | CAPTURED |
| `single_mode/get_choice_reward` | P2 | `career.api.ts` – | CAPTURED |
| `single_mode/gain_skills` | P2 | `career.api.ts` – | CAPTURED |
| `single_mode/continue` | P2 | `career.api.ts` – | HANDLER |
| `single_mode/change_running_style` | P2/P3 | `career.api.ts` – | HANDLER |
| `single_mode/multi_race_reserve` | P2 | `career.api.ts` – | HANDLER |
| `single_mode/change_short_cut` | P2 | `career.api.ts` – | HANDLER |
| `single_mode/select_succession` | P2 | `career.api.ts` – | HANDLER |
| `single_mode/minigame_end` | P2 | `career.api.ts` – | SYNTH |
| `single_mode/factor_select` | P2 | `career.api.ts` – | CAPTURED |
| `single_mode/factor_lottery` | P2 | `career.api.ts` – | SYNTH |
| `single_mode/factor_order_load` | P2 | `career.api.ts` – | HANDLER |
| `single_mode/factor_relottery_end` | P2 | `career.api.ts` – | HANDLER |
| `single_mode/finish` | P2 | `career.api.ts` – | CAPTURED |
| `single_mode_team/team_edit` | P2 | `team.api.ts` – | CAPTURED |
| `single_mode_team/opponent_list` | P2 | `team.api.ts` – | CAPTURED |
| `single_mode_team/team_race_*` | P2/P3 | `team.api.ts` – | CAPTURED |
| `single_mode/race_entry` | P3 | `race.api.ts` – | CAPTURED |
| `single_mode/race_analyze` / `race/analyze` | P3 | `race.api.ts` – | HANDLER |
| `single_mode/race_start` | P3 | `race.api.ts` – | CAPTURED |
| `single_mode/race_out` | P3 | `race.api.ts` – | CAPTURED |
| `single_mode/race_end` | P3 | `race.api.ts` – | CAPTURED |
| `daily_race/*` | P3 | `race.api.ts` – | HANDLER / CAPTURED |
| `daily_race_skip/race_skip` | P3 | `race.api.ts` – | CAPTURED |
| `legend_race/*` | P3 | `race.api.ts` – | HANDLER |
| `daily_legend_race/*` | P3 | `race.api.ts` – | HANDLER |
| `practice_race/*` | P3 | `race.api.ts` – | HANDLER |
| `main_story_race/*` | P3 | `race.api.ts` – | HANDLER |
| `gacha/index` | P4 | `gacha.api.ts` – | HANDLER |
| `gacha/exec` | P4 | `gacha.api.ts` – | HANDLER |
| `gacha/get_history` | P4 | `gacha.api.ts` – | HANDLER |
| `gacha/limit_exchange` | P4 | `gacha.api.ts` – | HANDLER |
| `card/*` | P4 | `cards.api.ts` – | HANDLER |
| `support_card/*` | P4 | `cards.api.ts` – | HANDLER |
| `support_card_deck/*` | P4 | `cards.api.ts` – | HANDLER |
| `trained_chara/*` | P4 | `trained.api.ts` – | CAPTURED (load) / HANDLER |
| `present/*` | P4 | `presents.api.ts` – | HANDLER |
| `mission/*` | P4 | `presents.api.ts` – | HANDLER |
| `item/*` | P4 | `shop.api.ts` – | HANDLER / CAPTURED |
| `user/*` (profile) | P4 | `user.api.ts` – | HANDLER |
| `honor/*` | P4 | `social.api.ts` – | HANDLER |
| `friend/*` | P4 | `social.api.ts` – | HANDLER |
| `story_event/*` | P4 | `social.api.ts` – | CAPTURED (index) / HANDLER |
| `character_story/*`, `main_story/*`, `extra_story/*` | P5 | `story.api.ts` – | HANDLER |
| `jukebox/*`, `live_theater/*` | P5 | `audio.api.ts` – | HANDLER |
| `circle*`, `room_match/*` | P5 | `social.api.ts` – | HANDLER |
| `campaign_walking/*`, `idle_single_mode/*`, `training_challenge/*`, `note/*`, `serial_code/*` | P5 | `misc.api.ts` – | HANDLER / TBD |
| `payment/*` | — | — | out of scope |

---

## 9. Appendix B — nested types

### B.1 `UserInfo`

```ts
interface UserInfo {
  viewer_id: string;
  name: string;
  honor_id: number;
  honor_data: Record<string, unknown>;
  sex: number;                    // 1 | 2
  tutorial_step: number;          // 1000 after change_sex
  leader_chara_id: number;
  leader_chara_dress_id: number;
  support_card_id: number;
  partner_chara_id: number;
  bonus_follow_num: number;
  fan: number;
  rank_score: number;
  best_team_evaluation_point: number;
  last_ticket_natural_recovery_time: string;
  register_time: string;
  create_time: string;
  update_time: string;
  comment: string;
  birth_day: number;
}
```

### B.2 `CharaInfo`

Field list in §4.1. All stats are numbers; `skill_array` is
`{skill_id, level}[]`; `skill_tips_array` is `{group_id, rarity, level}[]`.

### B.3 `HomeInfo` / `CommandInfo`

```ts
interface CommandInfo {
  command_type: number;          // 1 training, 3 outing, 7 rest, 8 infirmary
  command_id: number;
  is_enable: 0 | 1;
  training_partner_array: number[];
  tips_event_partner_array: number[];
  params_inc_dec_info_array: { target_type: number; value: number }[];
  failure_rate: number;
  level: number;
}

interface HomeInfo {
  command_info_array: CommandInfo[];
  race_entry_restriction: number;
  disable_command_id_array: number[];
  available_continue_num: number;
  available_free_continue_num: number;
  free_continue_num: number;
  free_continue_time: number;
  shortened_race_state: number;
}
```

### B.4 `RaceHorseData`

Field list in §5.7.

### B.5 `RaceStartInfo`

```ts
interface RaceStartInfo {
  program_id: number;
  random_seed: number;
  season: number;
  weather: number;
  ground_condition: number;
  race_horse_data: RaceHorseData[];
  continue_num: number;
  is_force_running_style: number;
}
```

### B.6 `RaceRewardInfo`

```ts
interface RaceRewardInfo {
  result_rank: number;
  result_time: number;              // milliseconds
  race_reward: { item_type: number; item_id: number; item_num: number }[];
  race_reward_bonus: unknown[];
  gained_fans: number;
  campaign_id_array: number[];
  race_reward_plus_bonus: unknown[];
  race_reward_bonus_win: unknown[];
}
```

### B.7 `RewardSummaryInfo`

```ts
interface RewardSummaryInfo {
  add_item_list: { item_id: number; number: number }[];
  add_piece_list: { piece_id: number; piece_num: number }[];
  add_card_list: unknown[];
  add_card_bonus_info: unknown | null;
  add_support_card_list: unknown[];
  add_support_card_num_array: { support_card_id: number; number: number; item_type: number }[];
  add_honor_list: unknown[];
  add_chara_list: unknown[];
  add_cloth_list: { cloth_id: number }[];
  add_music_list: unknown[];
  add_story_id_array: number[];
  add_fcoin: number;
  add_present_num: number;
  add_total_fan: number;
  new_chara_profile_array: unknown[];
  force_update_honor_id: number;
}
```

### B.8 `TrainedChara`

```ts
interface TrainedChara {
  viewer_id: string;
  trained_chara_id: number;
  owner_viewer_id: number;
  owner_trained_chara_id: number;
  single_mode_chara_id: number;
  chara_seed: number;
  card_id: number;
  succession_trained_chara_id_1: number;
  succession_trained_chara_id_2: number;
  use_type: number;
  speed: number; stamina: number; power: number; wiz: number; guts: number;
  fans: number;
  rank_score: number;
  rank: number;
  scenario_id: number;
  route_id: number;
  arrive_route_race_id: number;
  proper_ground_turf: number; proper_ground_dirt: number;
  proper_running_style_nige: number; proper_running_style_senko: number;
  proper_running_style_sashi: number; proper_running_style_oikomi: number;
  proper_distance_short: number; proper_distance_mile: number;
  proper_distance_middle: number; proper_distance_long: number;
  succession_num: number;
  rarity: number;
  is_saved: number;
  is_locked: number;
  talent_level: number;
  race_cloth_id: number;
  chara_grade: number;
  running_style: number;
  nickname_id: number;
  wins: number;
  register_time: string;
  create_time: string;
  skill_array: { skill_id: number; level: number }[];
  support_card_list: unknown[];
  race_result_list: unknown[];
  win_saddle_id_array: number[];
  nickname_id_array: number[];
  factor_info_array: { factor_id: number; level: number }[];
  factor_extend_array: unknown[];
  succession_chara_array: unknown[];
}
```

### B.9 `SupportCardDeck`

```ts
interface SupportCardDeck {
  deck_id: number;
  name: string;
  support_card_id_array: number[];   // exactly 5 slots, 0 = empty
}
```

### B.10 `Present`

```ts
interface Present {
  present_id: number;
  state: 0 | 1;                      // 0 = unclaimed
  reward_type: number;               // 90 carats, 51 support, 70 outfit, 91 money
  reward_id: number;
  reward_count: number;
  message_id: number;
  message_param_value_1: number;
  message_param_value_2: number;
  message_param_value_3: number;
  message_param_value_4: number;
  reward_limit_time: number;         // 4133948399 = never
  receive_time: string;
  create_time: string;
  free_message: string;
}
```

---

## 10. Appendix C — TBD / never-captured

These are implemented from `dump.cs` or independent clients, not from a real
wire capture. Verify before building a screen that depends on exact keys.

| Endpoint | Why it's uncertain |
|---|---|
| `single_mode/factor_lottery` | never captured; `dump.cs` shape only |
| `single_mode/minigame_end` | response side unknown beyond the event |
| `single_mode/change_short_cut` | never captured; `dump.cs` declaration |
| `single_mode/select_succession` | response is empty; applies on a later call |
| `gacha/limit_exchange` | never captured; `dump.cs` shape |
| `gacha/select_prize` / `gacha/get_prize_history` | no real prize flow exists |
| `support_card_deck/change_party` | request captured, response shape from the dump |
| `practice_race/race_start` | handler-built; no fixture pair in this capture |
| `room_match/*` | handler-built; no fixture pair |
| `circle*` | handler-built; no fixture pair |
| `idle_single_mode/*` | partially `TBD`; the server may refuse with `205` |
| `note/*` | handler-built; several endpoints are no-ops |
| `serial_code/register` | handler-built; code table may be empty |

When in doubt, capture a real session with the Unity client and add the
fixture pair — that is how the confidence tags get upgraded.

---

## 11. Appendix D — known gaps in the current client

These are P0-level issues that the new phases will inherit if not fixed:

1. `core/state/session.store.ts:5` still imports `readSync` from `node:fs`
   (unused). It breaks `tsc -p tsconfig.spec.json`; delete it.
2. The home template renders the wallet only. It does not yet show
   `user_info.name`, the trainer id, `tp_info`, or the scenario list.
3. No error surface: `startSession` / `loadIndex` failures throw into the
   console; `status` never becomes `'error'`.
4. No route guard: `/home` can be reached with `status !== 'ready'`.
5. `app.spec.ts` still uses a stale selector and does not provide `Router`.
6. `read_info/index` has a wrapper but no consumer.
7. `npm test` / `npm run build` are not runnable in the current container
   (Node 20.19.2 vs. Angular 22's required ≥ 22.22.3).
8. `race_scenario` decoding is not implemented yet (P3 work).
9. `single_mode/load` is not called on reload yet — P0 resumes at the home
   screen, P2 must resume into the career.
10. The signup button has no double-click guard; accepted because Google
    login replaces account creation later.

---

## 12. Appendix E — references

| Path | Why |
|---|---|
| `umaBack/server/app/dispatch.py` | routing, `HANDLERS` aliases, session/error handling |
| `umaBack/server/app/handlers/` | authoritative request/response contracts |
| `umaBack/server/fixtures/capture_06d26c/` | 385 real REQ/RES pairs |
| `umaBack/server/data/seeds/load_index_fresh.json` | 105-key home blob |
| `umaBack/server/app/handlers/single_mode_team.py` | P2/P3 career + race contracts |
| `umaBack/server/app/simulation/scenario_format.py` | `race_scenario` binary layout |
| `umaBack/admin_panel/static/race-viewer.js` | proven canvas replay viewer |
| `browser-client-phasing.md` | phase definitions |
| `browser-client-architecture.md` | protocol / relay / pipeline context |
| `browser-client-phase0-status.md` | P0 implementation + verification log |
| `umaFront/uma/src/app/core/protocol/uma-client.ts` | wire codec, sid chain, boilerplate |
| `umaFront/uma/src/app/core/api/` | existing P0 wrappers + model types |
