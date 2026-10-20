export interface CountryEntry {
  country: string;
  country_type: number;
}

export interface PreSignupData {
  attest: boolean;
  nonce: string;
  enable_steam_account: boolean;
  country_list: CountryEntry[];
}

export interface SignupData {
  viewer_id: number | string;
  auth_key: string;
}

export interface StartSessionData {
  attest: boolean;
  nonce: string;
  terms_updated: boolean;
  is_tutorial: boolean;
  resource_version: string;
}

export interface ReadInfoData {
  home_story_data_array: unknown[];
  short_episode_data_array: unknown[];
  home_poster_data_array: unknown[];
  tutorial_guide_data_array: { id: number }[];
  [key: string]: unknown;
}

export interface UserInfo {
  viewer_id: string;
  name: string;
  honor_id: number;
  sex: number;
  fan: number;
  register_time: string;
  leader_chara_id: number;
  [key: string]: unknown;
}

/**
 * The load/index home blob: 105 keys on the live server.
 *
 * Only the ones we actually read are typed; the rest fall through the index
 * signature. (With `noPropertyAccessFromIndexSignature` on, index-signature
 * keys need `data['x']` -- but explicitly declared keys still use `data.x`.)
 */
export interface LoadIndexData {
  user_info: UserInfo;
  coin_info: { coin: number; fcoin: number };
  tp_info: { current_tp: number; max_tp: number; max_recovery_time: number };
  rp_info: { current_rp: number; max_rp: number; max_recovery_time: number };
  single_mode_scenario_id_array: number[];
  [key: string]: unknown;
}

