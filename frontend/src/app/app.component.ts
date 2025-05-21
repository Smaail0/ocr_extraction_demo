import { Component }        from '@angular/core';
import { ActivatedRoute, Router, RouterModule, RouterOutlet, Data, NavigationEnd }     from '@angular/router';
import { AuthService } from './services/auth.service';
import { SidebarComponent } from './components/sidebar/sidebar.component';
import { filter, map } from 'rxjs/operators';
import { CommonModule } from '@angular/common';
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterModule,
    SidebarComponent
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  showSidebar = true;

  constructor(private router: Router) {
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd)
    ).subscribe(() => {
      this.showSidebar = this.shouldShowSidebar();
    });
  }

  private shouldShowSidebar(): boolean {
    // start at the root
    let route = this.router.routerState.snapshot.root;

    // drill down to the deepest activated route
    while (route.firstChild) {
      route = route.firstChild;
    }

    // pull out hideSidebar (it may be undefined)
    const hide = route.data['hideSidebar'] as boolean | undefined;
    return hide !== true;  // show unless hideSidebar === true
  }
}
