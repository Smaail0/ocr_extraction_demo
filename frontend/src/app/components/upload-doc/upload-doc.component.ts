import { Component, ElementRef, EventEmitter, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError, finalize, tap } from 'rxjs/operators';
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
  uploadDocuments(): void {
    if (this.isSubmitDisabled) return;
    this.isUploading = true;
    this.uploadProgress = 0;

    // kick off one OCR call per file
    const calls = this.uploadFiles.map((u, idx) =>
      this.documentsService.processBulletin(u.file).pipe(
        tap(() => {
          // increment progress as each completes
          this.uploadProgress = Math.round((idx + 1) / this.uploadFiles.length * 100);
        }),
        catchError(err => {
          console.error('OCR failed for', u.file.name, err);
          return of(null);   // swallow errors so all Observables complete
        })
      )
    );

    forkJoin(calls).pipe(
      finalize(() => this.isUploading = false)
    ).subscribe({
      next: results => {
        const successful = results.filter(r => r !== null);
        if (!successful.length) {
          return alert('All OCR requests failed');
        }
        // build a minimal array of { documentType, dossierId, ... } objects
        // successful is already that parsed JSON from your backend
        if (successful.length === 1) {
          this.router.navigate([`extracted/${this.uploadFiles[0].id}`], {
            state: { files: successful }
          });
        } else {
          this.router.navigate(['extracted/tabs'], {
            state: { files: successful }
          });
        }
        this.close.emit(true);
      },
      error: err => {
        console.error('Unexpected error in OCR pipeline', err);
        alert('Extraction error, please try again.');
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