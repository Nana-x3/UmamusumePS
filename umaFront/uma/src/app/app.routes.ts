import { Routes } from '@angular/router';
import { ProtocolCheckComponent } from './testStuff/protocol-check.component';
import { SignInComponent } from './components/signIn.component/signIn.component';
import { HomeComponent } from './components/home.component/home.component';


export const routes: Routes = [
  { path: 'check', component: ProtocolCheckComponent },
  { path: 'home', component: HomeComponent },
  { path: '', component: SignInComponent },
];


