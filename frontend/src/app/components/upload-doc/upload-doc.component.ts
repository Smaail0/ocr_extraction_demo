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
    return this.isUploading;
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

  // 1) First, parse all files
  const parseCalls = this.uploadFiles.map(u => {
    u.status = 'uploading';
    return this.documentsService.parseDocument(u.file).pipe(
      tap(() => { u.progress = 100; u.status = 'success'; }),
      catchError(err => {
        u.status = 'error';
        this.serverError = err?.error?.detail 
          || 'Please upload a Bulletin de soins or a prescription';
        return of(null);
      })
    );
  });

  forkJoin(parseCalls)
    .pipe(finalize(() => this.isUploading = false))
    .subscribe({
      next: parsedResults => {
        if (this.serverError) {
          // one of them already failed classification → bail out
          return;
        }

        // keep only the successful parses
        const files = parsedResults.filter(r => !!r);

        // 2) Build save‐to‐DB calls
        const saveCalls: Observable<any>[] = files.map(f => {
          if (f.header.documentType === 'prescription') {
            // inject the missing fields
            const payload = {
              ...f,
              totalInWords: f.totalInWords ?? '',
              // if patientIdentity OCR failed, use beneficiaryId as fallback
              patientIdentity: f.patientIdentity ?? f.beneficiaryId ?? ''
            };
            return this.documentsService.savePrescription(payload);
          } else {
            return this.documentsService.saveBulletinData(f);
          }
        });

        // 3) fire all the save calls in parallel
        forkJoin(saveCalls).subscribe({
          next: savedResponses => {
            // 4) once they're all saved, navigate exactly as before
            const prescriptions = files.filter(f => f.header.documentType === 'prescription');
            const bulletins     = files.filter(f => f.header.documentType === 'bulletin_de_soin');
            const idxOf         = (arr: any[], x: any) => arr.indexOf(x);

            if (this.mode === 'embedded') {
              this.extracted.emit(files);
              return;
            }

            // same tab‐selection logic...
            if (prescriptions.length && !bulletins.length) {
              this.router.navigate(
                ['/extracted'],
                { state: { files, selectedIndex: idxOf(files, prescriptions[0]) } }
              );
            } else if (bulletins.length && !prescriptions.length) {
              this.router.navigate(
                ['/extracted'],
                { state: { files, selectedIndex: idxOf(files, bulletins[0]) } }
              );
            } else if (prescriptions.length) {
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
          },
          error: saveErr => {
            console.error('Error saving documents:', saveErr);
            alert('Failed to save documents to the server.');
          }
        });
      },
      error: _ => alert('Extraction error')
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