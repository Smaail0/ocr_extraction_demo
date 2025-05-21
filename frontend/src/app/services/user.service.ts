// src/app/services/user.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { User }       from '../models/user.model';

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly baseUrl = 'http://localhost:8000/api/users';

  constructor(private http: HttpClient) {}

  list(): Observable<User[]> {
    return this.http.get<User[]>(this.baseUrl);
  }

  create(payload: { username: string; email: string; password: string; is_superuser: boolean }) {
    return this.http.post<User>(this.baseUrl, payload);
  }

  // PUT /api/users/{id}  (no trailing slash)
  patch(id: number, payload: Partial<User>): Observable<User> {
    return this.http.patch<User>(`${this.baseUrl}/${id}`, payload);
  }

  // DELETE /api/users/{id}  (no trailing slash)
  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }
}
