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
import type {
  LoadIndexData,
  PreSignupData,
  ReadInfoData,
  SignupData,
  StartSessionData,
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
    optinUserBirth: number;
    dmaState: number;
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
}
