import { Routes } from '@angular/router';
import { ProtocolCheckComponent } from './testStuff/protocol-check.component';
import { SignInComponent } from './components/signIn.component/signIn.component';


export const routes: Routes = [
  { path: 'check', component: ProtocolCheckComponent },
  { path: '', component: SignInComponent },
];


