import { Component, inject} from "@angular/core";
import { SessionStore } from "../../core/state/session.store";
import { FormsModule } from "@angular/forms";


@Component({
  selector: "app-logIn",
  standalone: true,
  imports: [FormsModule],
  templateUrl: "./signIn.component.html",
  styleUrl: "./signIn.component.scss"
})

export class SignInComponent {

  public isSignUp: boolean = false
  public sessionStore = inject(SessionStore)
  public selectedCountry: string = ''


}
