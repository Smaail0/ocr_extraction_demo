import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { Observable, throwError, of } from 'rxjs';
import { Prescription, PrescriptionCreate } from '../models/prescription.model'; // Adjust the 
import { catchError, tap, map, filter } from 'rxjs/operators'; // Adjust the import path as necessary

@Injectable({
  providedIn: 'root'
})
export class DocumentsService {
  private apiUrl = 'http://localhost:8000';

  constructor(private http: HttpClient) {}

  uploadDocuments(files: File[]): Observable<any> {
    const formData = new FormData();
    files.forEach(file => formData.append('files', file)); // 'files' not 'files[]'
  
    return this.http.post(`${this.apiUrl}/bulletin/upload`, formData).pipe(
      tap(response => console.log('Upload success:', response)),
      catchError(this.handleError('Error uploading documents'))
    );
  }
  
  getBulletinById(id: number): Observable<any> {
    return this.http.get(`${this.apiUrl}/bulletin/${id}`).pipe(
      catchError(this.handleError(`Error fetching bulletin with ID ${id}`))
    );
  }

  processBulletin(file: File): Observable<any> {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return this.http.post<any>(`${this.apiUrl}/bulletin/parse`, fd).pipe(
      tap(res => console.log('Bulletin OCR result:', res)),
      catchError((err: HttpErrorResponse) => {
        console.error('Error processing bulletin', err);
        return throwError(() => err);
      })
    );
  }

  processPrescription(file: File): Observable<Prescription> {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return this.http.post<Prescription>(`${this.apiUrl}/prescription/parse`, fd).pipe(
      tap(res => console.log('Prescription OCR result:', res)),
      catchError((err: HttpErrorResponse) => {
        console.error('Error processing prescription', err);
        return throwError(() => err);
      })
    );
  }

  saveBulletinData(data: any): Observable<any> {
    if (data.id) {
      return this.http.put(`${this.apiUrl}/bulletin/${data.id}`, data).pipe(
        tap(savedData => console.log('Bulletin updated:', savedData)),
        catchError(this.handleError('Error updating bulletin'))
      );
    } else {
      return this.http.post(`${this.apiUrl}/bulletin/`, data).pipe(
        tap(savedData => console.log('New bulletin created:', savedData)),
        catchError(this.handleError('Error creating bulletin'))
      );
    }
  }

  getLatestBulletin(): Observable<any> {
    return this.http.get(`${this.apiUrl}/bulletin/uploaded/latest`).pipe(
      catchError(error => {
        console.error('Error fetching latest bulletin:', error);
        // Return a default value for any error, not just 404
        return of({ filename: null, original_name: null, uploaded_at: null, exists: false });
      })
    );
  }

  getAllUploadedBulletins(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/bulletin/uploaded/all`).pipe(
      catchError(error => {
        if (error.status === 404) {
          return of([]);
        }
        return throwError(() => error);
      })
    );
  }

  getPrescriptionById(id: number): Observable<Prescription> {
    return this.http
      .get<Prescription>(`${this.apiUrl}/prescription/${id}`)
      .pipe(
        catchError((err: HttpErrorResponse) => {
          console.error(`Error fetching prescription ${id}`, err);
          return throwError(() => err);
        })
      );
  }

  parseDocument(file: File): Observable<any> {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return this.http.post<any>(`${this.apiUrl}/documents/parse`, fd).pipe(
      tap(res => console.log('OCR result:', res)),
      catchError(this.handleError('Error processing document'))
    );
}

  savePrescription(p: PrescriptionCreate): Observable<Prescription> {
    return this.http.post<Prescription>(`${this.apiUrl}/prescription`, p);
  }
  
  private handleError(message: string) {
    return (error: HttpErrorResponse) => {
      console.error(`${message}:`, error);
      return throwError(() => new Error(message));
    };
  }
}

