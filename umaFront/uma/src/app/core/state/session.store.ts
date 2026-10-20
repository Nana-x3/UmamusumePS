import { Injectable, inject } from "@angular/core";
import { ApiClient } from "../api/api-client";
import { ViewerId } from "../accounts/account-id";
import {
  UserInfo
} from "../api/models/phase0.apitypes";



@Injectable({providedIn: 'root'})


//holds the session state -- groundtruth -- only user of ApiClient
export class SessionStore {
  private readonly api = inject(ApiClient)

  //state
  status: 'idle' | 'connecting' | 'ready' | 'error' = 'idle'
  viewerid: ViewerId = ''
  userInfo: UserInfo | null = null
  wallet =  {coin: 0, fcoin: 0, tp: 0, rp: 0}
  scenarioIds:  number[] = []
  error: string | null = null

  isReady(): boolean {return this.status === 'ready'}
  getTrainerName(): string {return  this.userInfo?.name ?? ''}

  //actions


}
