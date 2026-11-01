import { Component, inject} from "@angular/core";
import { SessionStore } from "../../core/state/session.store";
import { Router } from "@angular/router";

@Component({
  selector: "app-home",
  standalone: true,
  imports: [],
  templateUrl: "./home.component.html",
  styleUrl: "./home.component.scss"
})

export class HomeComponent{


  public sessionStore = inject(SessionStore)
  private router = inject(Router)



  ngOnInit(){
      if (!this.sessionStore.idIsSet()){
          this.router.navigate(['/'])
      }
  }
}

