import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError, finalize, tap } from 'rxjs/operators';
import { DocumentsService } from '../../services/documents.service';
import {
  CdkDragDrop,
  moveItemInArray,
  DragDropModule,
} from '@angular/cdk/drag-drop';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
import { Courier, UploadedFileInfo } from '../../models/courier.model';
import { MatDialogRef } from '@angular/material/dialog';

interface UploadFile {
  file: File;
  id: string;
  preview: string;
  thumbnails?: string[];
  uploadProgress: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
}

@Component({
  selector: 'app-upload-doc',
  standalone: true,
  imports: [FormsModule, CommonModule, DragDropModule],
  templateUrl: './upload-doc.component.html',
  styleUrls: ['./upload-doc.component.css'],
})
export class UploadDocComponent {
  @Input() mode: 'route' | 'embedded' = 'route';
  @Output() extracted = new EventEmitter<any[]>();
  @Output() close = new EventEmitter<boolean>();

  formData = {
    matFisc: '',
    nomAdhe: '',
    nomBenef: '',
  };

  isDragOver = false;
  uploadProgress = 0;

  uploadFiles: UploadFile[] = [];
  isUploading = false;
  serverError: string | null = null;

  readonly MAX_FILES = 1;
  readonly ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];

  constructor(
    private documentsService: DocumentsService,
    private router: Router,
    private dialogRef: MatDialogRef<UploadDocComponent>
  ) {}

  ngOnInit() {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/pdfjs/pdf.worker.mjs';
  }

  get canAddMoreFiles() {
    return this.uploadFiles.length < this.MAX_FILES;
  }

  get isSubmitDisabled() {
    return (
      this.uploadFiles.length !== this.MAX_FILES ||
      !this.formData.matFisc ||
      !this.formData.nomAdhe ||
      !this.formData.nomBenef ||
      this.isUploading
    );
  }

  onDragOver(evt: DragEvent) {
    evt.preventDefault();
  }
  onDrop(evt: DragEvent) {
    evt.preventDefault();
    if (!this.canAddMoreFiles) return;
    this.handleFiles(evt.dataTransfer!.files);
  }
  onFileSelected(evt: Event) {
    const inp = evt.target as HTMLInputElement;
    if (inp.files) this.handleFiles(inp.files);
    inp.value = '';
  }
  private handleFiles(files: FileList) {
    const slots = this.MAX_FILES - this.uploadFiles.length;
    Array.from(files)
      .slice(0, slots)
      .forEach((f) => {
        if (!this.ALLOWED_TYPES.includes(f.type))
          return alert(`Unsupported: ${f.name}`);
        this.addFile(f);
      });
  }
  removeFile(i: number) {
    URL.revokeObjectURL(this.uploadFiles[i].preview);
    this.uploadFiles.splice(i, 1);
  }
  dropListDropped(evt: CdkDragDrop<UploadFile[]>) {
    moveItemInArray(this.uploadFiles, evt.previousIndex, evt.currentIndex);
  }

  private addFile(f: File) {
    const uf: UploadFile = {
      file: f,
      id: Date.now().toString(36) + Math.random().toString(36).substr(2),
      preview:
        f.type === 'application/pdf'
          ? '/PDF_icon.webp'
          : URL.createObjectURL(f),
      uploadProgress: 0,
      status: 'pending',
    };
    this.uploadFiles.push(uf);
    if (f.type === 'application/pdf') this.generatePdfThumbnails(uf);
  }

  private async generatePdfThumbnails(u: UploadFile) {
    const data = await new Response(u.file).arrayBuffer();
    const pdf = await pdfjsLib.getDocument(new Uint8Array(data)).promise;
    const thumbs: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 0.2 });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width;
      canvas.height = vp.height;
      await page.render({
        canvasContext: canvas.getContext('2d')!,
        viewport: vp,
      }).promise;
      thumbs.push(canvas.toDataURL('image/png'));
    }
    u.thumbnails = thumbs;
  }

  uploadDocuments() {
    if (this.isSubmitDisabled) return;
    this.serverError = null;
    this.isUploading = true;

    this.uploadFiles.forEach((u) => (u.status = 'uploading'));

    // 1) Open a blank tab immediately (so the browser knows it's user‐initiated)
    const newTab = window.open('', '_blank');

    console.time('server‐upload');
    this.documentsService
      .uploadCourier(
        this.formData.matFisc,
        this.formData.nomAdhe,
        this.formData.nomBenef,
        this.uploadFiles.map((u) => u.file),
        []
      )
      .pipe(
        finalize(() => {
          this.isUploading = false;
          console.timeEnd('server‐upload');
        })
      )
      .subscribe({
        next: (courier) => {
          this.uploadFiles.forEach((u) => (u.status = 'success'));
          this.dialogRef.close();

          // 2) Once the server returns, build the real URL
          const url = `${window.location.origin}/courriers/${courier.id}/extracted`;

          // 3) Navigate the already‐opened tab to that URL
          if (newTab) {
            newTab.location.href = url;
          } else {
            // Fallback (if for some reason newTab is null), open in this tab:
            window.open(url, '_blank');
          }

          // 4) Reload the current page (dashboard) so the new courier shows up
          window.location.reload();
        },
        error: (err) => {
          this.uploadFiles.forEach((u) => (u.status = 'error'));
          this.serverError = err.error?.detail || 'Upload failed';

          // If upload fails, close the blank tab immediately
          if (newTab) {
            newTab.close();
          }
        },
      });
  }

  formatFileSize(size: number): string {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  trackById(_: number, item: UploadFile) {
    return item.id;
  }

  closeSection() {
    this.dialogRef.close(false);
  }
}
