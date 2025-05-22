import { Component, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin, of, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { catchError, finalize, tap } from 'rxjs/operators';
import { DocumentsService } from '../../services/documents.service';
import {
  CdkDragDrop,
  moveItemInArray,
  DragDropModule,
} from '@angular/cdk/drag-drop';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
import { MatDialogRef } from '@angular/material/dialog';

interface UploadFile {
  file: File;
  id: string;
  preview: string;
  thumbnails?: string[];
  uploadProgress: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
}

interface CourierSuggestion {
  matricule: string;
  nom_complet_adherent: string;
  nom_complet_beneficiaire: string;
  id: number;
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
  @ViewChild('uploadForm') uploadForm: NgForm | undefined;

  formData = {
    mat: '',
    nomAdhe: '',
    nomBenef: '',
  };

  formSubmitted = false;
  isDragOver = false;
  uploadProgress = 0;

  uploadFiles: UploadFile[] = [];
  isUploading = false;
  serverError: string | null = null;

  // Autocomplete properties
  matriculeSuggestions: CourierSuggestion[] = [];
  adherentSuggestions: CourierSuggestion[] = [];
  showMatriculeSuggestions = false;
  showAdherentSuggestions = false;
  selectedCourier: CourierSuggestion | null = null;
  isLoadingSuggestions = false;

  readonly MAX_FILES = 5;
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
      !this.formData.mat ||
      !this.formData.nomAdhe ||
      !this.formData.nomBenef ||
      this.uploadFiles.length === 0 ||
      this.isUploading
    );
  }

  // Autocomplete methods
  onMatriculeInput(event: any) {
    const value = event.target.value.trim();
    if (value.length >= 2) {
      this.searchByMatricule(value);
    } else {
      this.showMatriculeSuggestions = false;
      this.matriculeSuggestions = [];
    }
  }

  onAdherentInput(event: any) {
    const value = event.target.value.trim();
    if (value.length >= 2) {
      this.searchByAdherent(value);
    } else {
      this.showAdherentSuggestions = false;
      this.adherentSuggestions = [];
    }
  }

  private searchByMatricule(query: string) {
    this.isLoadingSuggestions = true;
    this.documentsService.searchCouriersByMatricule(query).subscribe({
      next: (results: CourierSuggestion[]) => {
        this.matriculeSuggestions = results;
        this.showMatriculeSuggestions = results.length > 0;
        this.isLoadingSuggestions = false;
      },
      error: (err) => {
        console.error('Error searching matricules:', err);
        this.isLoadingSuggestions = false;
        this.showMatriculeSuggestions = false;
      }
    });
  }

  private searchByAdherent(query: string) {
    this.isLoadingSuggestions = true;
    this.documentsService.searchCouriersByAdherent(query).subscribe({
      next: (results: CourierSuggestion[]) => {
        this.adherentSuggestions = results;
        this.showAdherentSuggestions = results.length > 0;
        this.isLoadingSuggestions = false;
      },
      error: (err) => {
        console.error('Error searching adherents:', err);
        this.isLoadingSuggestions = false;
        this.showAdherentSuggestions = false;
      }
    });
  }

  selectMatriculeSuggestion(suggestion: CourierSuggestion, event?: Event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    
    this.selectedCourier = suggestion;
    this.formData.mat = suggestion.matricule;
    this.formData.nomAdhe = suggestion.nom_complet_adherent;
    this.formData.nomBenef = suggestion.nom_complet_beneficiaire;
    
    this.showMatriculeSuggestions = false;
    this.showAdherentSuggestions = false;
    this.matriculeSuggestions = [];
    this.adherentSuggestions = [];
  }

  selectAdherentSuggestion(suggestion: CourierSuggestion, event?: Event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    
    this.selectedCourier = suggestion;
    this.formData.mat = suggestion.matricule;
    this.formData.nomAdhe = suggestion.nom_complet_adherent;
    this.formData.nomBenef = suggestion.nom_complet_beneficiaire;
    
    this.showMatriculeSuggestions = false;
    this.showAdherentSuggestions = false;
    this.matriculeSuggestions = [];
    this.adherentSuggestions = [];
  }

  onInputFocus(field: string) {
    // Hide suggestions when focusing on different fields
    if (field !== 'matricule') {
      this.showMatriculeSuggestions = false;
    }
    if (field !== 'adherent') {
      this.showAdherentSuggestions = false;
    }
  }

  onInputBlur(field: string) {
    // Delay hiding suggestions to allow for clicks
    setTimeout(() => {
      if (field === 'matricule') {
        this.showMatriculeSuggestions = false;
      } else if (field === 'adherent') {
        this.showAdherentSuggestions = false;
      }
    }, 200);
  }

  // Original methods remain the same
  onDragOver(evt: DragEvent) {
    evt.preventDefault();
    this.isDragOver = true;
  }

  onDragLeave(evt: DragEvent) {
    evt.preventDefault();
    this.isDragOver = false;
  }

  onDrop(evt: DragEvent) {
    evt.preventDefault();
    this.isDragOver = false;
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
          return alert(`Format non supporté: ${f.name}`);
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

  validateForm(): boolean {
    this.formSubmitted = true;
    
    Object.keys(this.formData).forEach(key => {
      const control = this.uploadForm?.controls[key];
      if (control) {
        control.markAsTouched();
        control.updateValueAndValidity();
      }
    });

    if (!this.formData.mat || !this.formData.nomAdhe || !this.formData.nomBenef) {
      return false;
    }

    if (this.uploadFiles.length === 0) {
      this.serverError = "Veuillez télécharger au moins un fichier.";
      return false;
    }

    return true;
  }

  uploadDocuments() {
    if (!this.validateForm()) return;
    
    this.serverError = null;
    this.isUploading = true;

    // First, detect each file's type
    const detectCalls = this.uploadFiles.map((u) => {
      u.status = 'uploading';
      return this.documentsService.parseDocument(u.file).pipe(
        tap(() => (u.uploadProgress = 50)),
        catchError((err) => {
          u.status = 'error';
          this.serverError = err.error?.detail || 'Document invalide';
          return of(null);
        })
      );
    });

    forkJoin(detectCalls)
      .pipe(
        finalize(() => {
          if (!this.serverError) this.isUploading = false;
        })
      )
      .subscribe((results) => {
        if (this.serverError) return;

        // Check if matricule exists and upload accordingly
        if (this.selectedCourier) {
          // Upload to existing courier using matricule endpoint
          this.uploadToExistingCourier();
        } else {
          // Create new courier
          this.createNewCourier(results);
        }
      });
  }

  private uploadToExistingCourier() {
    const fd = new FormData();
    fd.append('nom_complet_adherent', this.formData.nomAdhe);
    fd.append('nom_complet_beneficiaire', this.formData.nomBenef);
    this.uploadFiles.forEach((u) =>
      fd.append('files', u.file, u.file.name)
    );

    this.documentsService.uploadCourierToMatricule(this.formData.mat, fd).subscribe({
      next: (response) => {
        this.uploadFiles.forEach((u) => {
          u.uploadProgress = 100;
          u.status = 'success';
        });
        
        this.closeDialog();
        
        if (this.mode === 'embedded') {
          this.extracted.emit(response.uploaded_files);
        } else {
          // Navigate to the existing courier
          this.router.navigate([`/extracted/courier/${this.selectedCourier!.id}`]);
        }
      },
      error: (err) => {
        this.serverError = `Échec du téléchargement: ${err.status} ${err.statusText}`;
        this.isUploading = false;
      },
    });
  }

  private createNewCourier(results: any[]) {
    const fd = new FormData();
    fd.append('matricule', this.formData.mat);
    fd.append('nom_complet_adherent', this.formData.nomAdhe);
    fd.append('nom_complet_beneficiaire', this.formData.nomBenef);
    this.uploadFiles.forEach((u) =>
      fd.append('files', u.file, u.file.name)
    );

    this.documentsService.uploadDocuments(fd).subscribe({
      next: (courier) => {
        this.uploadFiles.forEach((u) => {
          u.uploadProgress = 100;
          u.status = 'success';
        });
        
        this.closeDialog();

        if (this.mode === 'embedded') {
          this.extracted.emit(results.filter((r) => !!r)!);
        } else {
          this.router.navigate([`/extracted/${courier.id}`]);
        }
      },
      error: (err) => {
        this.serverError = `Échec du téléchargement: ${err.status} ${err.statusText}`;
        this.isUploading = false;
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

  closeDialog() {
    this.dialogRef.close(true); 
  }
}