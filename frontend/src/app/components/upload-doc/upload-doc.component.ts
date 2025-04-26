import { Component, ElementRef, EventEmitter, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin, of, throwError } from 'rxjs';
import { catchError, finalize, map, switchMap, tap } from 'rxjs/operators';
import { DocumentsService } from '../../services/documents.service';

interface UploadFile {
  file: File;
  id: string;
}

@Component({
  selector: 'app-upload-doc',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './upload-doc.component.html',
  styleUrls: ['./upload-doc.component.css']
})
export class UploadDocComponent {
  @ViewChild('dropArea') dropArea!: ElementRef;
  @Output() close = new EventEmitter<boolean>();

  uploadFiles: UploadFile[] = [];
  isUploading = false;
  uploadProgress = 0;

  readonly MAX_FILES = 5;
  readonly ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];

  constructor(
    private documentsService: DocumentsService,
    private router: Router,
  ) {}

  get canAddMoreFiles(): boolean {
    return this.uploadFiles.length < this.MAX_FILES;
  }

  get isSubmitDisabled(): boolean {
    return this.uploadFiles.length === 0 || this.isUploading;
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (this.canAddMoreFiles) this.dropArea.nativeElement.classList.add('active');
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dropArea.nativeElement.classList.remove('active');
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dropArea.nativeElement.classList.remove('active');
    if (!this.canAddMoreFiles) return this.showError(`Max ${this.MAX_FILES} files allowed`);
    const files = event.dataTransfer?.files;
    if (files) this.handleFiles(files);
  }

  onFileSelected(event: any): void {
    const inp = event.target as HTMLInputElement;
    const files = inp.files;
    if (!this.canAddMoreFiles) {
      this.showError(`Max ${this.MAX_FILES} files allowed`);
      inp.value = '';
      return;
    }
    if (files) this.handleFiles(files);
    inp.value = '';
  }

  private handleFiles(files: FileList) {
    const slots = this.MAX_FILES - this.uploadFiles.length;
    for (let i = 0; i < Math.min(files.length, slots); i++) {
      const f = files[i];
      if (!this.ALLOWED_TYPES.includes(f.type)) {
        this.showError(`Unsupported: ${f.name}`);
        continue;
      }
      if (this.uploadFiles.some(u => u.file.name === f.name && u.file.size === f.size)) {
        this.showError(`Duplicate ignored: ${f.name}`);
        continue;
      }
      this.uploadFiles.push({ file: f, id: this.generateUniqueId() });
    }
    if (files.length > slots) {
      this.showError(`Only added ${slots} file(s); limit ${this.MAX_FILES}.`);
    }
  }

  removeFile(i: number) {
    this.uploadFiles.splice(i, 1);
  }

  private showError(msg: string) {
    alert(msg);
  }

  closeSection() {
    this.close.emit(false);
  }

  private generateUniqueId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  /**
   * Called when user clicks “Extract Text”
   */
  /**
 * Called when user clicks "Extract Text"
 */
  uploadDocuments(): void {
    if (this.isSubmitDisabled) return;
    this.isUploading = true;
    this.uploadProgress = 0;
    
    const filesToUpload = this.uploadFiles.map(u => u.file);
    this.uploadProgress = 0;
    
    // Instead of guessing the type from filename, we'll process each file first
    // and then make the upload decision based on what the processing tells us
    const processingObservables = this.uploadFiles.map((u, idx) => {
      // Here we'll use the processBulletin endpoint for initial analysis
      // This is a workaround - ideally we'd have a dedicated type detection endpoint
      return this.documentsService.processBulletin(u.file).pipe(  
        tap((result) => {
          const progress = Math.round(((idx + 1) / this.uploadFiles.length) * 50);
          this.uploadProgress = progress;
        }),
        map(result => ({ file: u.file, result, index: idx })),
        catchError(err => {
          console.error('Processing failed for', u.file.name, err);
          return of(null);
        })
      );
    });
    
    forkJoin(processingObservables).pipe(
      switchMap(results => {
        // Filter out any nulls from failed processing
        const validResults = results.filter(r => r !== null) as any[];
        if (!validResults.length) {
          alert('Processing failed for all files');
          return throwError(() => new Error('All processing failed'));
        }
        
        // Now we can identify document types from the processing results
        const ordonnanceFiles: File[] = [];
        const bulletinFiles: File[] = [];
        const successfulResults: any[] = [];
        
        validResults.forEach(item => {
          if (item && item.result?.header?.documentType === 'ordonnance_model_v2') {
            ordonnanceFiles.push(item.file);
            successfulResults.push(item.result);
          } else {
            bulletinFiles.push(item.file);
            successfulResults.push(item.result);
          }
        });
        
        // Now do the appropriate uploads
        const uploadObservables = [];
        if (ordonnanceFiles.length > 0) {
          uploadObservables.push(
            this.documentsService.uploadOrdonnances(ordonnanceFiles).pipe(
              tap(() => console.log('Ordonnances uploaded'))
            )
          );
        }
        if (bulletinFiles.length > 0) {
          uploadObservables.push(
            this.documentsService.uploadBulletins(bulletinFiles).pipe(
              tap(() => console.log('Bulletins uploaded'))
            )
          );
        }
        
        this.uploadProgress = 75;
        return uploadObservables.length ? 
          forkJoin(uploadObservables).pipe(map(() => successfulResults)) : 
          of(successfulResults);
      }),
      finalize(() => this.isUploading = false)
    ).subscribe({
      next: (successfulResults) => {
        // Check if there are any results to process
        if (!successfulResults || !successfulResults.length) {
          return alert('No documents were successfully processed');
        }
        
        // Determine routing based on document type of results
        const hasOrdonnance = successfulResults.some(
          result => result?.header?.documentType === 'ordonnance_model_v2'
        );
        
        if (hasOrdonnance) {
          this.router.navigate(['ordonnance'], { state: { files: successfulResults } });
        } else {
          if (successfulResults.length === 1) {
            this.router.navigate([`extracted/${this.uploadFiles[0].id}`], { 
              state: { files: successfulResults } 
            });
          } else {
            this.router.navigate(['extracted/tabs'], { 
              state: { files: successfulResults } 
            });
          }
        }
        this.close.emit(true);
      },
      error: (err) => {
        console.error('Error in upload/processing pipeline', err);
        alert('Processing error, please try again.');
      }
    });
  }
  

  getFileIcon(file: File): string {
    if (file.type.includes('pdf')) return 'pdf-icon';
    if (file.type.includes('image')) return 'image-icon';
    return 'file-icon';
  }

  formatFileSize(size: number): string {
    if (size < 1024)             return `${size} B`;
    if (size < 1024 * 1024)      return `${(size/1024).toFixed(1)} KB`;
    return `${(size/(1024*1024)).toFixed(1)} MB`;
  }

  trackById(_: number, item: UploadFile) {
    return item.id;
  }
}