import { Injectable } from '@angular/core';
import {
  HttpClient,
  HttpRequest,
  HttpErrorResponse,
  HttpEventType,
  HttpParams,
  HttpResponse,
} from '@angular/common/http';
import { Observable, throwError, of } from 'rxjs';
import { Prescription, PrescriptionCreate } from '../models/prescription.model';
import { catchError, tap, map, filter } from 'rxjs/operators';
import { Bulletin } from '../models/bulletin.model';
import { BulletinCreate } from '../models/bulletin.model';
import { Courier } from '../models/courier.model';

export interface SignatureResult {
  akaze: number;
  ssim: number;
  genuine: boolean;
}

export interface DiagnoseResponseFR {
  diagnostiques: string[];
  medicament_hors_norme: string | null;
  raw_response: string;
}

export interface FileUpload {
  id: number;
  filename: string;
  original_name: string;
  type: 'prescription' | 'bulletin';

  prescription_id?: number | null;
  bulletin_id?: number | null;

  is_verified?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class DocumentsService {
  deleteDocument(documentId: number) {
    throw new Error('Method not implemented.');
  }
  private apiUrl = 'http://localhost:8000/api'; // Base API URL

  constructor(private http: HttpClient) {}

  // Get the latest courier
  getLatestCourrier(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/courrier/uploaded/latest`).pipe(
      tap((res) => console.log('Latest courier fetched:', res)),
      catchError((error) => {
        console.error('Error fetching latest courier:', error);
        return throwError(() => error);
      })
    );
  }

  // Get all couriers
  getAllCourrier(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/courrier/uploaded/all`).pipe(
      tap((res) => console.log('All couriers fetched:', res)),
      catchError((error) => {
        if (error.status === 404) {
          return of([]);
        }
        return throwError(() => error);
      })
    );
  }

  getFileUpload(fileId: number): Observable<FileUpload> {
    return this.http.get<FileUpload>(`${this.apiUrl}/files/${fileId}`);
  }

  // Other existing methods...
  getBulletinById(id: number): Observable<Bulletin> {
    return this.http.get<Bulletin>(`${this.apiUrl}/bulletins/${id}`).pipe(
      tap((bulletin) => console.log('Fetched bulletin:', bulletin)),
      catchError(this.handleError(`Error fetching bulletin ${id}`))
    );
  }

  processBulletin(file: File): Observable<any> {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return this.http.post<any>(`${this.apiUrl}/bulletin/parse`, fd).pipe(
      tap((res) => console.log('Bulletin OCR result:', res)),
      catchError((err: HttpErrorResponse) => {
        console.error('Error processing bulletin', err);
        return throwError(() => err);
      })
    );
  }

  processPrescription(file: File): Observable<Prescription> {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return this.http
      .post<Prescription>(`${this.apiUrl}/prescription/parse`, fd)
      .pipe(
        tap((res) => console.log('Prescription OCR result:', res)),
        catchError((err: HttpErrorResponse) => {
          console.error('Error processing prescription', err);
          return throwError(() => err);
        })
      );
  }

  getLatestBulletin(): Observable<any> {
    return this.http.get(`${this.apiUrl}/bulletin/uploaded/latest`).pipe(
      catchError((error) => {
        console.error('Error fetching latest bulletin:', error);
        return of({
          filename: null,
          original_name: null,
          uploaded_at: null,
          exists: false,
        });
      })
    );
  }

  getAllUploadedBulletins(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/bulletin/uploaded/all`).pipe(
      catchError((error) => {
        if (error.status === 404) {
          return of([]);
        }
        return throwError(() => error);
      })
    );
  }

  deleteBulletin(documentId: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/api/bulletin/${documentId}`).pipe(
      tap((response) => console.log('Bulletin deleted:', response)),
      catchError(this.handleError('Error deleting bulletin'))
    );
  }

  getPrescriptionById(id: number): Observable<Prescription> {
    return this.http
      .get<Prescription>(`${this.apiUrl}/prescriptions/${id}`)
      .pipe(catchError(this.handleError(`Error fetching prescription ${id}`)));
  }

  associateDocument(
    fileId: number,
    documentId: number,
    documentType: 'bulletin' | 'prescription' | 'ordonnance'
  ): Observable<any> {
    return this.http
      .post(`${this.apiUrl}/documents/associate`, {
        file_id: fileId,
        document_id: documentId,
        document_type: documentType,
      })
      .pipe(
        tap((res) => console.log('associateDocument →', res)),
        catchError(this.handleError('Error associating document'))
      );
  }

  createPrescription(
    dto: PrescriptionCreate,
    fileId?: number
  ): Observable<Prescription> {
    const options =
      fileId != null
        ? { params: new HttpParams().set('file_id', fileId.toString()) }
        : {};
    return this.http.post<Prescription>(
      `${this.apiUrl}/prescriptions`,
      dto,
      options
    );
  }

  uploadCourier(
    matFiscale: string,
    nomAdhe: string,
    nomBenef: string,
    files: File[],
    parsed: any[] // we can ignore this or remove it entirely
  ): Observable<Courier> {
    const fd = new FormData();
    fd.append('mat_fiscale', matFiscale);
    fd.append('nom_complet_adherent', nomAdhe);
    fd.append('nom_complet_beneficiaire', nomBenef);

    // Append every chosen File to “files”
    files.forEach((file) => {
      fd.append('files', file, file.name);
    });

    return this.http.post<Courier>(`${this.apiUrl}/courrier/upload`, fd).pipe(
      tap((c) => console.log('uploadCourier response', c)),
      catchError(this.handleError('Error uploading courier'))
    );
  }

  uploadAndParseFilesForCourier(
    courierId: number,
    files: File[]
  ): Observable<Courier> {
    const fd = new FormData();
    // Must match parameter names in the FastAPI endpoint
    files.forEach((f) => fd.append('files', f, f.name));

    // POST → /api/courriers/{courier_id}/files
    return this.http
      .post<Courier>(`${this.apiUrl}/courrier/${courierId}/files`, fd)
      .pipe(
        tap((c) => console.log('uploadAndParseFilesForCourier →', c)),
        catchError(
          this.handleError('Error uploading/parsing files for courier')
        )
      );
  }

  getOrdonnanceById(id: number): Observable<any> {
    return this.http
      .get(`${this.apiUrl}/ordonnance/${id}`)
      .pipe(
        catchError(this.handleError(`Error fetching ordonnance with ID ${id}`))
      );
  }

  getLatestOrdonnance(): Observable<any> {
    return this.http.get(`${this.apiUrl}/ordonnance/uploaded/latest`).pipe(
      catchError((error) => {
        console.error('Error fetching latest ordonnance:', error);
        return of({
          filename: null,
          original_name: null,
          uploaded_at: null,
          exists: false,
        });
      })
    );
  }

  getAllUploadedOrdonnances(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/ordonnance/uploaded/all`).pipe(
      tap((ordonnances) =>
        console.log('Number of ordonnances fetched:', ordonnances.length)
      ),
      catchError((error) => {
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
      .post<any>(`${this.apiUrl}/ordonnance/parse?_t=${timestamp}`, fd)
      .pipe(
        tap((res) => console.log('OCR result:', res)),
        catchError(this.handleError('Error processing ordonnance'))
      );
  }

  deleteOrdonnance(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/ordonnance/${id}`).pipe(
      tap((response) => console.log('Ordonnance deleted:', response)),
      catchError(this.handleError('Error deleting ordonnance'))
    );
  }

  deleteFile(fileId: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/files/${fileId}`).pipe(
      tap((response) => console.log('File deleted:', response)),
      catchError((error: HttpErrorResponse) => {
        console.error('Error deleting file:', error);
        return throwError(() => error);
      })
    );
  }

  private handleError(message: string) {
    return (err: HttpErrorResponse) => {
      console.error(`${message}:`, err);
      return throwError(() => new Error(message));
    };
  }

  verifySignature(id: number): Observable<SignatureResult> {
    return this.http.post<SignatureResult>(
      `${this.apiUrl}/prescriptions/${id}/verify-signature`,
      {}
    );
  }

  updatePrescription(
    id: number,
    dto: PrescriptionCreate,
    fileId?: number
  ): Observable<Prescription> {
    const options =
      fileId != null
        ? { params: new HttpParams().set('file_id', fileId.toString()) }
        : {};
    return this.http.put<Prescription>(
      `${this.apiUrl}/prescriptions/${id}`,
      dto,
      options
    );
  }

  createBulletin(dto: BulletinCreate, fileId?: number) {
    const opts =
      fileId != null
        ? { params: new HttpParams().set('file_id', fileId.toString()) }
        : {};

    return this.http.post<Bulletin>(`${this.apiUrl}/bulletins`, dto, opts);
  }

  updateBulletin(id: number, dto: BulletinCreate) {
    console.log('Updating bulletin with content:', dto);
    return this.http.put<Bulletin>(`${this.apiUrl}/bulletins/${id}`, dto);
  }

  getDiagnosesFR(
    items: { produit: string; [key: string]: any }[]
  ): Observable<DiagnoseResponseFR> {
    return this.http.post<DiagnoseResponseFR>(`${this.apiUrl}/diagnose_fr`, {
      items,
    });
  }
}
