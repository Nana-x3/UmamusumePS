import { Component, inject, signal } from '@angular/core';
import { ApiClient } from '../core/api/api-client';
import type { CountryEntry } from '../core/api/models/phase0.apitypes';

type CheckStatus = 'idle' | 'loading' | 'ok' | 'error';

@Component({
  selector: 'app-protocol-check',
  template: `
    <h1>Protocol check</h1>

    <p class="status">status: <strong>{{ status() }}</strong></p>

    @if (error(); as message) {
      <p class="error">{{ message }}</p>
    }

    @if (status() === 'ok') {
      <p>countries: <strong>{{ countries().length }}</strong></p>
      <p>result_code: {{ resultCode() }}</p>
      <p>sid: {{ sid() }}</p>
      <p>udid: {{ udid() }}</p>

      <label for="country">country</label>
      <select id="country" size="8">
        @for (entry of countries(); track entry.country) {
          <option [value]="entry.country">{{ entry.country }}</option>
        }
      </select>
    }

    <button type="button" (click)="run()" [disabled]="status() === 'loading'">
      {{ status() === 'loading' ? 'running...' : 'run again' }}
    </button>
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

  readonly status = signal<CheckStatus>('idle');
  readonly resultCode = signal<number | null>(null);
  readonly sid = signal<string | null>(null);
  readonly udid = signal<string | null>(null);
  readonly countries = signal<CountryEntry[]>([]);
  readonly error = signal<string | null>(null);

  constructor() {
    void this.run();
  }

  async run(): Promise<void> {
    this.status.set('loading');
    this.error.set(null);

    try {
      const data = await this.api.preSignup();
      this.countries.set(data.country_list);
      this.resultCode.set(1);
      this.sid.set(this.api.client.getLastSid());
      this.udid.set(this.api.client.getUdidHex());
      this.status.set('ok');
    } catch (error: unknown) {
      this.error.set(error instanceof Error ? error.message : String(error));
      this.status.set('error');
    }
  }
}
