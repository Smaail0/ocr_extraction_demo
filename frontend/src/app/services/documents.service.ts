import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { Observable, throwError, of } from 'rxjs';
import { catchError, tap, map, filter } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class DocumentsService {
  private apiUrl = 'http://localhost:8000';

  constructor(private http: HttpClient) {}

  // Bulletin methods
  uploadBulletins(files: File[]): Observable<any> {
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

  processBulletin(file: File): Observable<any> {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return this.http
      .post<any>(`${this.apiUrl}/bulletin/parse`, fd)
      .pipe(
        tap(res => console.log('OCR result:', res)),
        catchError(this.handleError('Error processing bulletin'))
      );
  }
  
  // Ordonnance methods
  uploadOrdonnances(files: File[]): Observable<any> {
    const formData = new FormData();
    files.forEach(file => formData.append('files', file));
  
    return this.http.post(`${this.apiUrl}/ordonnance/upload`, formData).pipe(
      tap(response => console.log('Upload success:', response)),
      catchError(this.handleError('Error uploading ordonnances'))
    );
  }

  getOrdonnanceById(id: number): Observable<any> {
    return this.http.get(`${this.apiUrl}/ordonnance/${id}`).pipe(
      catchError(this.handleError(`Error fetching ordonnance with ID ${id}`))
    );
  }

  saveOrdonnanceData(data: any): Observable<any> {
    if (data.id) {
      return this.http.put(`${this.apiUrl}/ordonnance/${data.id}`, data).pipe(
        tap(savedData => console.log('Ordonnance updated:', savedData)),
        catchError(this.handleError('Error updating ordonnance'))
      );
    } else {
      return this.http.post(`${this.apiUrl}/ordonnance/`, data).pipe(
        tap(savedData => console.log('New ordonnance created:', savedData)),
        catchError(this.handleError('Error creating ordonnance'))
      );
    }
  }

  getLatestOrdonnance(): Observable<any> {
    return this.http.get(`${this.apiUrl}/ordonnance/uploaded/latest`).pipe(
      catchError(error => {
        console.error('Error fetching latest ordonnance:', error);
        return of({ filename: null, original_name: null, uploaded_at: null, exists: false });
      })
    );
  }

  getAllUploadedOrdonnances(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/ordonnance/uploaded/all`).pipe(
      catchError(error => {
        if (error.status === 404) {
          return of([]);
        }
        return throwError(() => error);
      })
    );
  }

  processOrdonnance(file: File): Observable<any> {
    const fd = new FormData();
    fd.append('file', file, file.name);
    
    // Add timestamp to prevent caching
    const timestamp = new Date().getTime();
    
    return this.http
      .post<any>(`${this.apiUrl}/ordonnance/parse?_t=${timestamp}`, fd)
      .pipe(
        tap(res => console.log('OCR result:', res)),
        catchError(this.handleError('Error processing ordonnance'))
      );
  }
  
  getAllOrdonnances(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/ordonnance/`).pipe(
      catchError(error => {
        if (error.status === 404) {
          return of([]);
        }
        return throwError(() => error); 
      })
    );
  }

  deleteOrdonnance(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/ordonnance/${id}`).pipe(
      tap(response => console.log('Ordonnance deleted:', response)),
      catchError(this.handleError('Error deleting ordonnance'))
    );
  }
  
  private handleError(message: string) {
    return (error: HttpErrorResponse) => {
      console.error(`${message}:`, error);
      return throwError(() => new Error(message));
    };
  }
}