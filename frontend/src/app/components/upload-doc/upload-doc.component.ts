//Upload Document

import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Output, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DocumentsService } from '../../services/documents.service';
import { firstValueFrom } from 'rxjs';

interface UploadFile {
  file: File;
  id: string;
}

@Component({
  selector: 'app-upload-doc',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './upload-doc.component.html',
  styleUrl: './upload-doc.component.css'
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
    if (this.dropArea?.nativeElement && this.canAddMoreFiles) {
      this.dropArea.nativeElement.classList.add('active');
    }
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dropArea?.nativeElement.classList.remove('active');
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dropArea?.nativeElement.classList.remove('active');

    if (!this.canAddMoreFiles) {
      this.showError(`Maximum ${this.MAX_FILES} files allowed`);
      return;
    }

    const files = event.dataTransfer?.files;
    if (files) {
      this.handleFiles(files);
    }
  }

  onFileSelected(event: any): void {
    if (!this.canAddMoreFiles) {
      this.showError(`Maximum ${this.MAX_FILES} files allowed`);
      event.target.value = '';
      return;
    }

    const files = event.target.files;
    if (files) {
      this.handleFiles(files);
    }

    event.target.value = '';
  }

  handleFiles(files: FileList): void {
    const remainingSlots = this.MAX_FILES - this.uploadFiles.length;
    const filesToAdd = Math.min(files.length, remainingSlots);

    for (let i = 0; i < filesToAdd; i++) {
      const file = files[i];
      if (!this.ALLOWED_TYPES.includes(file.type)) {
        this.showError(`Unsupported file type: ${file.name}`);
        continue;
      }

      const isDuplicate = this.uploadFiles.some(
        f => f.file.name === file.name && f.file.size === file.size
      );
      if (isDuplicate) {
        this.showError(`Duplicate file ignored: ${file.name}`);
        continue;
      }

      this.uploadFiles.push({ file, id: this.generateUniqueId() });
    }

    if (files.length > remainingSlots) {
      this.showError(`Only added ${filesToAdd} file(s). Maximum of ${this.MAX_FILES} allowed.`);
    }
  }

  removeFile(index: number): void {
    this.uploadFiles.splice(index, 1);
  }

  showError(message: string): void {
    console.error(message); // You can replace this with a toast or snackbar
  }

  closeSection(): void {
    this.close.emit(false);
  }

  async uploadDocuments(): Promise<void> {
    if (this.isSubmitDisabled) return;
  
    this.isUploading = true;
    this.uploadProgress = 0;
  
    const files = this.uploadFiles.map(f => f.file);
  
    try {
      const result = await firstValueFrom(this.documentsService.uploadDocuments(files));
      console.log('Upload result:', result);
      this.uploadProgress = 100;
      this.processExtractedDocuments();
    } catch (error: any) {
      this.showError('Upload failed: ' + (error?.message || 'Unknown error'));
    } finally {
      this.isUploading = false;
    }
  }
  

  processExtractedDocuments(): void {
    this.close.emit(true);

    const files = this.uploadFiles.map(file => ({
      name: file.file.name,
      id: file.id
    }));

    if (files.length === 1) {
      this.router.navigate([`extracted/${files[0].id}`], { state: { files } });
    } else {
      this.router.navigate(['extracted/tabs'], { state: { files } });
    }
  }

  generateUniqueId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
  }

  getFileIcon(file: File): string {
    if (file.type.includes('pdf')) return 'pdf-icon';
    if (file.type.includes('image')) return 'image-icon';
    return 'file-icon';
  }

  formatFileSize(size: number): string {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  trackById(index: number, item: UploadFile): string {
    return item.id;
  }
}
