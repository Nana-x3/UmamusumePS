import { Component, inject} from "@angular/core";
import { SessionStore } from "../../core/state/session.store";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { Router } from "@angular/router";



@Component({
  selector: "app-logIn",
  standalone: true,
  imports: [FormsModule,RouterLink],
  templateUrl: "./signIn.component.html",
  styleUrl: "./signIn.component.scss"
})

export class SignInComponent {

  public isSignUp: boolean = false
  public sessionStore = inject(SessionStore)
  public selectedCountry: string = ''
  public newName: string = this.sessionStore.userInfo().name
  private router = inject(Router)

  async ngOnInit(){
    if(await this.sessionStore.resume()){
      this.router.navigate(['/home'])
    }
  }


}
