import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Courier } from '../models/courier.model';
import { Prescription } from '../models/prescription.model';
import { Bulletin } from '../models/bulletin.model';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class CourierService {
  // point at the /api root
  private apiUrl = environment.apiBaseUrl;

  constructor(private http: HttpClient) {}

  getCourier(id: number): Observable<Courier> {
    return this.http.get<Courier>(`${this.apiUrl}/courrier/${id}`);
  }

  getPrescription(id: number): Observable<Prescription> {
    return this.http.get<Prescription>(`${this.apiUrl}/prescriptions/${id}`);
  }

  getBulletin(id: number): Observable<Bulletin> {
    return this.http.get<Bulletin>(`${this.apiUrl}/bulletins/${id}`);
  }
}
