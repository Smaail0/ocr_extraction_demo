// src/app/guards/admin.guard.ts
import { Injectable } from '@angular/core';
import {
  CanActivate,
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  Router,
  UrlTree
} from '@angular/router';
import { AuthService } from '../services/auth.service';

@Injectable({ providedIn: 'root' })
export class AdminGuard implements CanActivate {
  constructor(private auth: AuthService, private router: Router) {}

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): boolean | UrlTree {
    // 1) If not logged in → send to /login
    if (!this.auth.isLoggedIn) {
      return this.router.createUrlTree(['/login'], {
        queryParams: { returnUrl: state.url }
      });
    }

    // 2) If logged in but not an admin → redirect to home (or dashboard)
    if (!this.auth.isAdmin) {
      return this.router.createUrlTree(['/']); // or ['/dashboard']
    }

    // 3) If logged in AND isAdmin → allow
    return true;
  }
}
