import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError, finalize, tap } from 'rxjs/operators';
import { DocumentsService } from '../../services/documents.service';

// Interface for each selected file + its document type
interface UploadFile {
  file: File;
  documentType: string;
  id: string;
}

@Component({
  selector: 'app-upload',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './upload.component.html',
  styleUrls: ['./upload.component.css']
})
export class UploadComponent {
  @Output() close = new EventEmitter<boolean>();

  uploadFiles: UploadFile[] = [];
  isUploading    = false;
  uploadProgress = 0;

  constructor(
    private documentsService: DocumentsService,
    private router: Router
  ) {}

  // Allow up to 5 files now
  readonly MAX_FILES = 5;
  readonly ALLOWED_TYPES = ['image/jpeg','image/png','application/pdf'];
  readonly documentTypes = [
    { value: 'ordonnance', label: 'Ordonnance' },
    { value: 'bulletin',   label: 'Bulletin de Soins' },
    { value: 'cnam',       label: 'Carte CNAM' }
  ];

  get canAddMoreFiles(): boolean {
    return this.uploadFiles.length < this.MAX_FILES;
  }

  get isSubmitDisabled(): boolean {
    return this.uploadFiles.length === 0 ||
           this.uploadFiles.some(f => !f.documentType) ||
           this.isUploading;
  }

  onDragOver(e: DragEvent) {
    e.preventDefault(); e.stopPropagation();
    if (this.canAddMoreFiles) document.getElementById('drop-area')?.classList.add('active');
  }
  onDragLeave(e: DragEvent) {
    e.preventDefault(); e.stopPropagation();
    document.getElementById('drop-area')?.classList.remove('active');
  }
  onDrop(e: DragEvent) {
    e.preventDefault(); e.stopPropagation();
    document.getElementById('drop-area')?.classList.remove('active');
    if (!this.canAddMoreFiles) return this.showError(`Max ${this.MAX_FILES} files allowed`);
    const files = e.dataTransfer?.files;
    if (files) this.handleFiles(files);
  }
  onFileSelected(e: Event) {
    const inp = e.target as HTMLInputElement;
    const files = inp.files;
    if (!this.canAddMoreFiles) {
      this.showError(`Max ${this.MAX_FILES} files allowed`);
      inp.value = '';
      return;
    }
    if (files) this.handleFiles(files);
    inp.value = '';
  }

  private handleFiles(list: FileList) {
    const slots = this.MAX_FILES - this.uploadFiles.length;
    for (let i = 0; i < Math.min(list.length, slots); i++) {
      const f = list[i];
      if (this.ALLOWED_TYPES.includes(f.type)) {
        this.uploadFiles.push({
          file: f,
          documentType: '',
          id:   this.generateUniqueId()
        });
      } else {
        this.showError(`Unsupported: ${f.name}`);
      }
    }
    if (list.length > slots) {
      this.showError(`Only added ${slots} files; limit is ${this.MAX_FILES}.`);
    }
  }

  removeFile(i: number) {
    this.uploadFiles.splice(i, 1);
  }

  private showError(msg: string) {
    alert(msg);
  }

  closeModal() {
    this.close.emit(false);
  }

  private generateUniqueId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  /** Called when user clicks “Extract Text” */
  uploadDocuments() {
    if (this.uploadFiles.length === 0) {
      return this.showError('Please select at least one file');
    }
    if (this.uploadFiles.some(f => !f.documentType)) {
      return this.showError('Please select a document type for each file');
    }

    this.isUploading = true;
    this.uploadProgress = 0;

    const calls = this.uploadFiles.map((u, idx) =>
      this.documentsService.processBulletin(u.file).pipe(
        tap(() => {
          this.uploadProgress = Math.round(((idx + 1) / this.uploadFiles.length) * 100);
        }),
        catchError(err => {
          console.error('OCR failed for', u.file.name, err);
          return of(null);
        })
      )
    );

    forkJoin(calls)
      .pipe(finalize(() => this.isUploading = false))
      .subscribe(results => {
        const successful = results.filter(r => r !== null);
        if (!successful.length) {
          return alert('All OCR requests failed');
        }

        // Navigate to /bulletin with parsed data in router state
        this.router.navigate(['/bulletin'], {
          state: { files: successful }
        });
        this.close.emit(true);
      }, err => {
        console.error('Unexpected error in OCR pipeline', err);
        alert('Failed to extract text');
      });
  }

  getFileIcon(file: File): string {
    if (file.type.includes('pdf'))   return 'pdf-icon';
    if (file.type.includes('image')) return 'image-icon';
    return 'file-icon';
  }

  formatFileSize(size: number): string {
    if (size < 1024)             return `${size} B`;
    if (size < 1024 * 1024)      return `${(size/1024).toFixed(1)} KB`;
    return `${(size/(1024*1024)).toFixed(1)} MB`;
  }
}
