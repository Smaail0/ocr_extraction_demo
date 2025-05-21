// src/app/guards/auth.guard.ts
import { Injectable }                 from '@angular/core';
import {
  CanActivate,
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  Router,
  UrlTree
} from '@angular/router';
import { AuthService }                from '../services/auth.service';

@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {
  constructor(private auth: AuthService, private router: Router) {}

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): boolean | UrlTree {
    if (this.auth.isLoggedIn && this.auth.isAdmin) {
      return true;
    }
    // not logged in at all → go to login
    if (!this.auth.isLoggedIn) {
      return this.router.createUrlTree(['/login'], {
        queryParams: { returnUrl: state.url }
      });
    }
    // logged in but not admin → send back home (or show 403)
    return this.router.createUrlTree(['/']);
  }
}
