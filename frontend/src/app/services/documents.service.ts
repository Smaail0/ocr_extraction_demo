import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { Observable, throwError, of } from 'rxjs';
import { Prescription, PrescriptionCreate } from '../models/prescription.model';
import { catchError, tap, map, filter } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class DocumentsService {
  deleteDocument(documentId: number) {
    throw new Error('Method not implemented.');
  }
  private apiUrl = 'http://localhost:8000'; // Base API URL

  constructor(private http: HttpClient) {}

  // Get the latest courier
  getLatestCourrier(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/api/courrier/uploaded/latest`).pipe(
      tap(res => console.log('Latest courier fetched:', res)),
      catchError(error => {
        console.error('Error fetching latest courier:', error);
        return throwError(() => error);
      })
    );
  }

  // Get all couriers
  getAllCourrier(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/api/courrier/uploaded/all`).pipe(
      tap(res => console.log('All couriers fetched:', res)),
      catchError(error => {
        if (error.status === 404) {
          return of([]);
        }
        return throwError(() => error);
      })
    );
  }



  // Other existing methods...
  getBulletinById(id: number): Observable<any> {
    return this.http.get(`${this.apiUrl}/api/bulletin/${id}`).pipe(
      catchError(this.handleError(`Error fetching bulletin with ID ${id}`))
    );
  }




  processBulletin(file: File): Observable<any> {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return this.http.post<any>(`${this.apiUrl}/api/bulletin/parse`, fd).pipe(
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
    return this.http.post<Prescription>(`${this.apiUrl}/api/prescription/parse`, fd).pipe(
      tap(res => console.log('Prescription OCR result:', res)),
      catchError((err: HttpErrorResponse) => {
        console.error('Error processing prescription', err);
        return throwError(() => err);
      })
    );
  }

  saveBulletinData(data: any): Observable<any> {
    if (data.id) {
      return this.http.put(`${this.apiUrl}/api/bulletin/${data.id}`, data).pipe(
        tap(savedData => console.log('Bulletin updated:', savedData)),
        catchError(this.handleError('Error updating bulletin'))
      );
    } else {
      return this.http.post(`${this.apiUrl}/api/bulletin/`, data).pipe(
        tap(savedData => console.log('New bulletin created:', savedData)),
        catchError(this.handleError('Error creating bulletin'))
      );
    }
  }

  getLatestBulletin(): Observable<any> {
    return this.http.get(`${this.apiUrl}/api/bulletin/uploaded/latest`).pipe(
      catchError(error => {
        console.error('Error fetching latest bulletin:', error);
        return of({ filename: null, original_name: null, uploaded_at: null, exists: false });
      })
    );
  }

  getAllUploadedBulletins(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/api/bulletin/uploaded/all`).pipe(
      catchError(error => {
        if (error.status === 404) {
          return of([]);
        }
        return throwError(() => error);
      })
    );
  }

  deleteBulletin(documentId: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/api/bulletin/${documentId}`).pipe(
      tap(response => console.log('Bulletin deleted:', response)),
      catchError(this.handleError('Error deleting bulletin'))
    );
  }


  parseDocument(file: File): Observable<any> {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return this.http.post<any>(`${this.apiUrl}/api/documents/parse`, fd).pipe( 
      tap(res => console.log('OCR result:', res)),
      catchError(this.handleError('Error processing document'))
    );
  }

  savePrescription(p: PrescriptionCreate): Observable<Prescription> {
    const headers = { 'Content-Type': 'application/json' };
    return this.http.post<Prescription>(`${this.apiUrl}/api/prescription/`, p, { headers })
      .pipe(
        tap(res => console.log('Prescription saved:', res)),
        catchError((error: HttpErrorResponse) => {
          console.error('Error saving prescription:', error);
          return throwError(() => error);
        })
      );
  }
  
  uploadDocuments(formData: FormData): Observable<any> {
    return this.http.post(
      `${this.apiUrl}/api/courrier/upload`,
      formData
    ).pipe(
      tap(r => console.log('uploadDocuments response', r)),
      catchError(this.handleError('Error uploading documents'))
    );
  }

  getOrdonnanceById(id: number): Observable<any> {
    return this.http.get(`${this.apiUrl}/api/ordonnance/${id}`).pipe(
      catchError(this.handleError(`Error fetching ordonnance with ID ${id}`))
    );
  }


  saveOrdonnanceData(data: any): Observable<any> {
    if (data.id) {
      return this.http.put(`${this.apiUrl}/api/ordonnance/${data.id}`, data).pipe(
        tap(savedData => console.log('Ordonnance updated:', savedData)),
        catchError(this.handleError('Error updating ordonnance'))
      );
    } else {
      return this.http.post(`${this.apiUrl}/api/ordonnance/`, data).pipe(
        tap(savedData => console.log('New ordonnance created:', savedData)),
        catchError(this.handleError('Error creating ordonnance'))
      );
    }
  }

  getLatestOrdonnance(): Observable<any> {
    return this.http.get(`${this.apiUrl}/api/ordonnance/uploaded/latest`).pipe(
      catchError(error => {
        console.error('Error fetching latest ordonnance:', error);
        return of({ filename: null, original_name: null, uploaded_at: null, exists: false });
      })
    );
  }

  getAllUploadedOrdonnances(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/api/ordonnance/uploaded/all`).pipe(
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
    
    const timestamp = new Date().getTime();

    return this.http
      .post<any>(`${this.apiUrl}/api/ordonnance/parse?_t=${timestamp}`, fd)
      .pipe(
        tap(res => console.log('OCR result:', res)),
        catchError(this.handleError('Error processing ordonnance'))
      );
  }

  deleteOrdonnance(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/api/ordonnance/${id}`).pipe(
      tap(response => console.log('Ordonnance deleted:', response)),
      catchError(this.handleError('Error deleting ordonnance'))
    );
  }

  getCourierById(id: number): Observable<any> {
    return this.http.get(`${this.apiUrl}/api/courrier/${id}`).pipe(
      catchError(this.handleError(`Error fetching courier with ID ${id}`))
    );
  }


  deleteFile(fileId: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/api/files/${fileId}`).pipe(
      tap(response => console.log('File deleted:', response)),
      catchError((error: HttpErrorResponse) => {
        console.error('Error deleting file:', error);
        return throwError(() => error);
      })
    );
  }


uploadFilesToCourier(courierId: number ,formData: FormData): Observable<any> {
  return this.http.post(`${this.apiUrl}/courriers/${courierId}/upload/`, formData, {
    reportProgress: true,
    observe: 'events'
  }).pipe(
    catchError(error => {
      console.error('Upload error:', error);
      throw error;
    })
  );
}
  
  private handleError(message: string) {
    return (error: HttpErrorResponse) => {
      console.error(`${message}:`, error);
      return throwError(() => new Error(message));
    };
  }




}