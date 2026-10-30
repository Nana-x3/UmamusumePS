import { Component, inject, signal } from '@angular/core';
import { ApiClient } from '../core/api/api-client';
import { SessionStore } from '../core/state/session.store';


@Component({
  selector: 'app-protocol-check',
  template: `
    <h1>Check Site</h1>

    <button (click)=doStuff()> Does Stuff </button>


  `,
  styles: `
    :host {
      display: block;
      padding: 1.5rem;
      font-family: system-ui, sans-serif;
    }
    .error { color: #b00; }
    select { display: block; width: 20rem; margin: 0.5rem 0 1rem; }
  `,
})
export class ProtocolCheckComponent {
  private readonly api = inject(ApiClient);
  private sessionStore = inject(SessionStore)

  doStuff(): void{
    this.sessionStore.getCountryList()

  }

}
