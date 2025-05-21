import { Injectable }             from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable }             from 'rxjs';
import { Router}                from '@angular/router';
import { User, UserCreate, UserUpdate } from '../models/user.model';

interface TokenPayload {
  sub: string;
  exp: number;
  is_superuser: boolean;
}

export interface TokenResponse {
  access_token: string;
  token_type:   string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
    private url = 'http://localhost:8000/login';
    private tokenKey = 'access_token';

  constructor(
    private http: HttpClient,
    private router: Router
    ) {}

    get token(): string | null {
        return localStorage.getItem(this.tokenKey);
    }

      private parseJwt(token: string): TokenPayload | null {
    try {
      const [, payloadBase64] = token.split('.');
      const base64 = payloadBase64.replace(/-/g, '+').replace(/_/g, '/');
      const json    = decodeURIComponent(atob(base64)
        .split('')
        .map(c => '%' + c.charCodeAt(0).toString(16).padStart(2,'0'))
        .join(''));
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

    get payload(): TokenPayload | null {
      return this.token ? this.parseJwt(this.token) : null;
    }

    get isLoggedIn(): boolean {
        return !!this.payload && (this.payload.exp * 1000) > Date.now();
    }

    get isAdmin(): boolean {
        return this.payload?.is_superuser === true;
    }

  logout() {
    localStorage.removeItem(this.tokenKey);
    this.router.navigate(['/login']);
  }

  login(email: string, password: string): Observable<TokenResponse> {
    const body = new HttpParams()
      .set('username', email)
      .set('password', password);

    return this.http.post<TokenResponse>(
      this.url,
      body.toString(),
      {
        headers: new HttpHeaders({
          'Content-Type': 'application/x-www-form-urlencoded'
        })
      }
    );
  }
}
