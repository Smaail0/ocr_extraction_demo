import { Component, ElementRef, EventEmitter, Output, ViewChild, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin, of, Observable } from 'rxjs';
import { catchError, finalize, tap } from 'rxjs/operators';
import { DocumentsService } from '../../services/documents.service';
import { CdkDragDrop, moveItemInArray, DragDropModule } from '@angular/cdk/drag-drop';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
import { StepperComponent } from '../stepper/stepper.component';

interface UploadFile {
  file: File;
  id: string;
  preview: string;
  thumbnails?: string[];
  progress: number;
  status: 'pending'|'uploading'|'success'|'error';
}

@Component({
  selector: 'app-upload-doc',
  standalone: true,
  imports: [FormsModule, CommonModule, DragDropModule, StepperComponent],
  templateUrl: './upload-doc.component.html',
  styleUrls: ['./upload-doc.component.css']
})
export class UploadDocComponent {
  @Input() mode: 'route'|'embedded' = 'route';
  @Output() extracted = new EventEmitter<any[]>();
  @Output() close = new EventEmitter<boolean>();

  uploadFiles: UploadFile[] = [];
  isUploading = false;
  uploadProgress = 0;
  isDragOver = false;

  serverError: string | null = null;

  readonly MAX_FILES = 2;
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

  ngOnInit() {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/pdfjs/pdf.worker.mjs';
  }

  onDragOver(evt: DragEvent) {
    evt.preventDefault();
    if (this.canAddMoreFiles) {
      this.isDragOver = true;
    }
  }

  onDragLeave(evt: DragEvent) {
    evt.preventDefault();
    this.isDragOver = false;
  }

  onDrop(evt: DragEvent) {
    evt.preventDefault();
    this.isDragOver = false;
    if (!this.canAddMoreFiles) {
      return alert(`Max ${this.MAX_FILES} files`);
    }
    if (evt.dataTransfer?.files) {
      this.handleFiles(evt.dataTransfer.files);
    }
  }

  onFileSelected(evt: Event) {
    const inp = evt.target as HTMLInputElement;
    if (inp.files) {
      this.handleFiles(inp.files);
    }
    inp.value = '';
  }
  

  private handleFiles(files: FileList) {
    const slots = this.MAX_FILES - this.uploadFiles.length;
    for (let i = 0; i < Math.min(files.length, slots); i++) {
      const f = files[i];
      if (!this.ALLOWED_TYPES.includes(f.type)) {
        alert(`Unsupported type: ${f.name}`);
        continue;
      }
      this.addFile(f);
    }
  }

  removeFile(i: number) {
    this.serverError = null;
    // revoke URL if image
    const p = this.uploadFiles[i].preview;
    if (p.startsWith('blob:')) URL.revokeObjectURL(p);
    this.uploadFiles.splice(i,1);
  }

  dropListDropped(evt: CdkDragDrop<UploadFile[]>) {
    moveItemInArray(this.uploadFiles, evt.previousIndex, evt.currentIndex);
  }

  private showError(msg: string) {
    alert(msg);
  }

  closeSection() {
    this.close.emit(false);
  }
  
  private addFile(f: File) {
    this.serverError = null;
    // 1) avoid duplicates
    const existing = this.uploadFiles.find(u =>
      u.file.name === f.name && u.file.size === f.size
    );
    if (existing) return;
  
    // 2) create the UploadFile object
    const uf: UploadFile = {
      file:      f,
      id:        this.generateUniqueId(),
      preview:   this.makePreview(f),  // blob-url or pdf-icon
      progress:  0,
      status:    'pending'
    };
  
    // 3) push it into your list
    this.uploadFiles.push(uf);
  
    // 4) if it's a PDF, kick off thumbnail generation
    if (f.type === 'application/pdf') {
      this.generatePdfThumbnails(uf);
    }
  }  

  private makePreview(file: File): string {
    if (file.type === 'application/pdf') {
      return '/PDF_icon.webp';  // put a PDF icon in assets
    }
    return URL.createObjectURL(file);
  }

  private generatePdfThumbnails(u: UploadFile) {
    const reader = new FileReader();
    reader.onload = async () => {
      const pdf = await pdfjsLib.getDocument(new Uint8Array(reader.result as ArrayBuffer)).promise;
      const thumbs: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const scale = 0.2; // tweak for desired thumbnail size
        const vp = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width  = vp.width;
        canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
        thumbs.push(canvas.toDataURL('image/png'));
      }
      u.thumbnails = thumbs;
    };
    reader.readAsArrayBuffer(u.file);
  }
  
  private generateUniqueId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

uploadDocuments(): void {
  if (this.isSubmitDisabled) return;
  this.isUploading = true;
  this.serverError = null;


  const calls = this.uploadFiles.map(u => {
    u.status = 'uploading';
    return this.documentsService.parseDocument(u.file).pipe(
      tap(() => { u.progress = 50; }),  // Set to 50% after OCR processing
      catchError(err => {
        u.status = 'error';
        this.serverError = err?.error?.detail || 'Please upload a Bulletin de Soins or a prescription';
        return of(null);
      })
    );
  });
  
  // Process all OCR calls first to determine document types
  forkJoin(calls)
    .pipe(finalize(() => !this.serverError && (this.isUploading = false)))
    .subscribe({
      next: (results: any[]) => {
        if (this.serverError) {
          this.isUploading = false;
          return;
        }
        
        const validResults = results.filter(r => !!r);
        
        // Separate files by type
        const prescriptionFiles: {file: File, result: any}[] = [];
        const bulletinFiles: {file: File, result: any}[] = [];
        
        // Match OCR results with the original files and categorize them
        validResults.forEach((result, index) => {
          if (result && result.header && result.header.documentType) {
            const fileObj = this.uploadFiles[index];
            if (result.header.documentType === 'prescription') {
              prescriptionFiles.push({file: fileObj.file, result});
            } else if (result.header.documentType === 'bulletin_de_soin') {
              bulletinFiles.push({file: fileObj.file, result});
            }
          }
        });
        
        // Upload files to their appropriate directories
        const uploadTasks: Observable<any>[] = [];
        
        if (bulletinFiles.length > 0) {
          const bulletinUpload = this.documentsService.uploadBulletins(
            bulletinFiles.map(item => item.file)
          ).pipe(
            tap(() => {
              bulletinFiles.forEach(item => {
                const fileObj = this.uploadFiles.find(u => u.file === item.file);
                if (fileObj) {
                  fileObj.progress = 100;
                  fileObj.status = 'success';
                }
              });
            }),
            catchError(err => {
              this.serverError = 'Failed to upload bulletin files';
              console.error('Bulletin upload error:', err);
              return of(null);
            })
          );
          uploadTasks.push(bulletinUpload);
        }
        
        if (prescriptionFiles.length > 0) {
          const prescriptionUpload = this.documentsService.uploadOrdonnances(
            prescriptionFiles.map(item => item.file)
          ).pipe(
            tap(() => {
              prescriptionFiles.forEach(item => {
                const fileObj = this.uploadFiles.find(u => u.file === item.file);
                if (fileObj) {
                  fileObj.progress = 100;
                  fileObj.status = 'success';
                }
              });
            }),
            catchError(err => {
              this.serverError = 'Failed to upload prescription files';
              console.error('Prescription upload error:', err);
              return of(null);
            })
          );
          uploadTasks.push(prescriptionUpload);
        }
        
        // If there are files to upload, process the uploads
        if (uploadTasks.length > 0) {
          forkJoin(uploadTasks).subscribe({
            next: (_) => {
              if (this.serverError) {
                return;
              }
              
              // All files processed and uploaded successfully
              this.processNavigation(validResults);
            },
            error: (err) => {
              this.serverError = 'Failed to complete file uploads';
              console.error('Upload error:', err);
            },
            complete: () => {
              this.isUploading = false;
            }
          });
        } else {
          this.isUploading = false;
          if (validResults.length > 0) {
            this.processNavigation(validResults);
          }
        }
      },
      error: (err) => {
        this.serverError = 'Failed to process documents';
        console.error('OCR error:', err);
        this.isUploading = false;
      }
    });
}

// Helper method to handle navigation based on processed files
private processNavigation(files: any[]): void {
  if (this.mode === 'embedded') {
    this.extracted.emit(files);
    return;
  }

  const prescriptions = files.filter(f => f.header.documentType === 'prescription');
  const bulletins = files.filter(f => f.header.documentType === 'bulletin_de_soin');
  const idxOf = (arr: any[], x: any) => arr.indexOf(x);

  // Navigation logic remains the same
  if (prescriptions.length && !bulletins.length) {
    this.router.navigate(
      ['/extracted'],
      { state: { files, selectedIndex: idxOf(files, prescriptions[0]) } }
    );
    return;
  }

  if (bulletins.length && !prescriptions.length) {
    this.router.navigate(
      ['/extracted'],
      { state: { files, selectedIndex: idxOf(files, bulletins[0]) } }
    );
    return;
  }

  if (prescriptions.length) {
    this.router.navigate(
      ['/extracted'],
      { state: { files, selectedIndex: idxOf(files, prescriptions[0]) } }
    );
  } else {
    this.router.navigate(
      ['/extracted'],
      { state: { files, selectedIndex: idxOf(files, bulletins[0]) } }
    );
  }
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