import { Injectable, inject, signal } from "@angular/core";
import { ApiClient } from "../api/api-client";
import { ViewerId } from "../accounts/account-id";
import type * as Phase0Types from "../api/models/phase0.apitypes";



@Injectable({providedIn: 'root'})


//holds the session state -- groundtruth -- only user of ApiClient
export class SessionStore {
  private readonly api = inject(ApiClient)

  //state
  status: 'idle' | 'connecting' | 'ready' | 'error' = 'idle'
  viewerid = signal<ViewerId>('')
  userInfo: Phase0Types.UserInfo | null = null
  wallet =  {coin: 0, fcoin: 0, tp: 0, rp: 0}
  scenarioIds:  number[] = []
  error: string | null = null

  //sign up

  countries = signal<Phase0Types.CountryEntry[]>([])

  isReady(): boolean {return this.status === 'ready'}
  getTrainerName(): string {return  this.userInfo?.name ?? ''}


  //actions


  //SignupData

  async getCountryList(): Promise<void>{
    const data = await this.api.preSignup()

    this.countries.set(data.country_list)
    console.log("country list",this.countries)
  }


  async signUp(country: string): Promise<void>{
    if (this.viewerid() === ''){
      const data = await this.api.signup({country, optinUserBirth: 0,dmaState: 0} )
      this.viewerid.set(data.viewer_id)

      console.log("new user signed up, Id:",this.viewerid)

    }else{
      throw new Error(`userId allread set for this session: ${this.viewerid()}`)
    }

  }






}
