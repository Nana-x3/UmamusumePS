import { Injectable, inject, signal } from "@angular/core";
import { ApiClient } from "../api/api-client";
import { ViewerId } from "../accounts/account-id";
import type * as Phase0Types from "../api/models/phase0.apitypes";
import { readSync } from "node:fs";



@Injectable({providedIn: 'root'})


//holds the session state -- groundtruth -- only user of ApiClient
export class SessionStore {
  private readonly api = inject(ApiClient)

  //state
  status= signal<'idle' | 'connecting' | 'ready' | 'error'> ('idle')
  viewerid = signal<ViewerId>('')
  userInfo = signal<Phase0Types.UserInfo>({viewer_id:'',name:'',honor_id:0,sex:0,fan:0,register_time:'',leader_chara_id:0})
  wallet = signal<{coin: number, fcoin: number}>({coin: 0, fcoin:0})
  tp_info = signal<{ current_tp: number, max_tp: number, max_recovery_time: number }>({current_tp:0,max_tp:0,max_recovery_time:0})
  rp_info = signal<{ current_rp: number, max_rp: number, max_recovery_time: number }>({current_rp:0,max_rp:0,max_recovery_time:0})
  scenarioIds:  number[] = []

  //sign up

  countries = signal<Phase0Types.CountryEntry[]>([])

  isReady(): boolean {return this.status() === 'ready'}
  getTrainerName(): string {return  this.userInfo().name ?? ''}
  idIsSet(): boolean {return this.viewerid() !== ''}


  //actions
  async resume(): Promise<boolean> {
    const id = this.api.client.getViewerId();
    if (!id) {return false}else{
    this.viewerid.set(id);
    await this.startSession();

    return true

    }
  }

  signOut():void{
    this.api.client.setViewerId('');
    this.viewerid.set('');

    this.status.set('idle');
    this.userInfo.set({
      viewer_id: '', name: '', honor_id: 0, sex: 0,
      fan: 0, register_time: '', leader_chara_id: 0,
    });
    this.wallet.set({ coin: 0, fcoin: 0 });
    this.tp_info.set({ current_tp: 0, max_tp: 0, max_recovery_time: 0 });
    this.rp_info.set({ current_rp: 0, max_rp: 0, max_recovery_time: 0 });
    this.scenarioIds = []
  }



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

      console.log("new user signed up, Id:",this.viewerid())

    }else{
      throw new Error(`userId allread set for this session: ${this.viewerid()}`)
    }

  }


  async startSession(): Promise<void>{
      if (this.viewerid() === ''){
        throw new Error('userId not set')
      }
      this.status.set('connecting')
      this.api.client.setViewerId(this.viewerid())

      await this.api.startSession()
      const userData = await this.api.loadIndex()
      const name = userData?.user_info?.name
      if (name == null){
        throw new Error('load Index Data undefiend')
      }
      this.userInfo!.set(userData.user_info)
      this.wallet!.set(userData.coin_info)
      this.tp_info!.set(userData.tp_info)
      this.rp_info!.set(userData.rp_info)
      this.scenarioIds! = userData.single_mode_scenario_id_array

      console.log("session started for ", this.userInfo().name)
      this.status.set('ready')


  }

  async signUpAndStart(country: string): Promise<void>{
    await this.signUp(country)
    await this.startSession()
  }


  async changeName(name: string): Promise<void>{

    if (this.status() !== 'ready'){
      throw new Error('start session first before change name')
    }
    const nameTrimmed = name.trim()
    if (!nameTrimmed || nameTrimmed.length > 16){
      throw new Error('name needs to be between 1-16 chars')
    }

    this.userInfo.set(await this.api.changeName(nameTrimmed))
    console.log("user name changed to ", this.userInfo().name)
  }


  async changeSex(sex: 1 | 2): Promise<void>{
    if (this.status() !== 'ready'){
      throw new Error('start session first before change sex')
    }

    this.userInfo.set(await this.api.changeSex(sex))
    console.log("user sex changed to ", this.userInfo().sex)
  }






}
