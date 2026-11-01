import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SessionStore } from './core/state/session.store';
import { Router } from '@angular/router';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('uma');
  public sessionStore = inject(SessionStore)
  private router = inject(Router)

  public logOut():void{
    this.sessionStore.signOut()
    this.router.navigate(['/'])
  }
}
