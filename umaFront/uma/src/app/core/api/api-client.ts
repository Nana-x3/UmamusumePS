/**
 * The Angular-facing wrapper.
 *
 * One UmaClient for the whole app -- that matters, because the client holds
 * the udid and the session id in memory. Two instances would mean two
 * sessions and two rotating sids.
 */

import { Injectable } from '@angular/core';

import { UmaClient } from '../protocol/uma-client';
import { loadIndex } from './load.api';
import { readInfoIndex } from './read_info.api';
import { preSignup, signup, startSession } from './tool.api';
import { changeName, changeSex } from './user.api';
import type {
  LoadIndexData,
  PreSignupData,
  ReadInfoData,
  SignupData,
  StartSessionData,
  UserInfo
} from './models/phase0.apitypes.ts';

@Injectable({ providedIn: 'root' })
export class ApiClient {
  /** The raw client -- exposed so the debug screen can show udid/sid. */
  readonly client = new UmaClient({ baseUrl: '/g' });

  preSignup(): Promise<PreSignupData> {
    return preSignup(this.client);
  }

  signup(params: {
    country: string;
    optinUserBirth: 0;
    dmaState: 0;
  }): Promise<SignupData> {
    return signup(this.client, params);
  }

  startSession(): Promise<StartSessionData> {
    return startSession(this.client);
  }

  loadIndex(): Promise<LoadIndexData> {
    return loadIndex(this.client);
  }

  readInfoIndex(): Promise<ReadInfoData> {
    return readInfoIndex(this.client);
  }

  changeName(name: string): Promise<UserInfo>{
    return changeName(this.client, name)
  }

  changeSex(sex: 1 | 2): Promise<UserInfo>{
    return changeSex(this.client, sex)
  }
}
