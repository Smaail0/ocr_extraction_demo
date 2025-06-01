import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DocumentsService } from '../../services/documents.service';
import { Router, RouterModule } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, catchError } from 'rxjs/operators';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { Observable, of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { UploadDocComponent } from '../upload-doc/upload-doc.component';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog.component';
import { FileUpload } from '../../services/documents.service';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';

interface Document {
  id: number;
  type: 'prescription' | 'bulletin';
  date: string;
  status: 'verified' | 'pending' | 'flagged' | 'missed';
}

interface DocumentDetail {
  id: number;
  type: string;
  fileName: string;
  fileSize: string;
  date: string;
  status: string;
  is_verified?: boolean;
}

interface Courier {
  id: number;
  mat_fiscale: string;
  nom_complet_adherent: string;
  nom_complet_beneficiaire: string;
  files: {
    id: number;
    type: string;
    filename: string;
    original_name: string;
    path: string;
    uploaded_at: string;

    is_verified?: boolean;
    size_in_bytes?: number;
  }[];
  created_at: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatDialogModule, RouterModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css'],
})
export class DashboardComponent implements OnInit {
  documents: Document[] = [];
  filteredDocuments: Document[] = [];

  // Courier data
  couriers: Courier[] = [];
  filteredCouriers: Courier[] = [];
  isLoadingData = false;

  // Expanded rows state
  expandedRows: boolean[] = [];

  MAX_FILES = 5;

  // Stats
  totalDocuments = 0;
  ordonnancesCount = 0;
  pendingOrdonnances = 0;
  bulletinsCount = 0;
  flaggedBulletins = 0;
  newDocumentsThisWeek = 0;
  courriersCount = 0;

  filterForm = new FormGroup({
    searchTerm: new FormControl(''),
    type: new FormControl('all'),
    status: new FormControl('all'),
    date: new FormControl('all'),
  });

  uploadFiles: Record<
    number,
    Array<{
      file: File;
      preview: string;
      thumbnails?: string[];
      status: 'pending' | 'uploading' | 'success' | 'error';
    }>
  > = {};

  isDragOver: Record<number, boolean> = {};
  showUploadSection: Record<number, boolean> = {};

  constructor(
    private documentsService: DocumentsService,
    private router: Router,
    private dialog: MatDialog,
    public auth: AuthService
  ) {}

  ngOnInit(): void {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/pdfjs/pdf.worker.mjs';
    this.loadAllDocuments();
    this.loadAllCouriers();

    this.filterForm
      .get('searchTerm')
      ?.valueChanges.pipe(debounceTime(300))
      .subscribe(() => this.applyFilters());

    this.filterForm
      .get('type')
      ?.valueChanges.subscribe(() => this.applyFilters());
    this.filterForm
      .get('status')
      ?.valueChanges.subscribe(() => this.applyFilters());
    this.filterForm
      .get('date')
      ?.valueChanges.subscribe(() => this.applyFilters());
  }

  loadAllCouriers() {
    this.isLoadingData = true;
    console.log('Loading couriers');

    this.documentsService.getAllCourrier().subscribe({
      next: (courriers) => {
        console.log('Couriers loaded:', courriers);
        this.couriers = courriers;
        this.filteredCouriers = courriers; // Initialize filtered couriers
        this.courriersCount = courriers.length;

        // Initialize expandedRows, and prepare uploadFiles / showUploadSection / isDragOver for each courier ID:
        this.expandedRows = new Array(courriers.length).fill(false);

        for (let c of courriers) {
          // Create an empty array for any future uploads for this courier
          this.uploadFiles[c.id] = [];
          // By default, the “upload section” is hidden until row expands
          this.showUploadSection[c.id] = false;
          // Drag‐over CSS flag
          this.isDragOver[c.id] = false;
        }

        this.isLoadingData = false;
        this.calculateStats(); // Recalculate stats after loading couriers
      },
      error: (error) => {
        console.error('Error loading couriers:', error);
        this.isLoadingData = false;
      },
    });
  }

  private async generatePdfThumbnails(u: {
    file: File;
    thumbnails?: string[];
    preview: string;
    status: string;
  }): Promise<void> {
    // read the PDF into an ArrayBuffer
    const data = await new Response(u.file).arrayBuffer();
    const pdf = await pdfjsLib.getDocument(new Uint8Array(data)).promise;
    const thumbs: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 0.2 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({
        canvasContext: canvas.getContext('2d')!,
        viewport: viewport,
      }).promise;
      thumbs.push(canvas.toDataURL('image/png'));
    }
    u.thumbnails = thumbs;
  }

  loadAllDocuments() {
    console.log('Starting to load documents');
    this.isLoadingData = true;

    this.documentsService
      .getAllUploadedOrdonnances()
      .subscribe((ordonnances) => {
        console.log('Raw ordonnances data:', ordonnances);

        if (ordonnances.length > 0) {
          console.log('Sample ordonnance fields:', Object.keys(ordonnances[0]));
        }

        const ordonnanceDocs = ordonnances.map((ord) => {
          return {
            id: ord.id,
            type: 'prescription' as const,
            date: ord.uploaded_at || new Date().toISOString(),
            status: ord.status || 'missed',
          };
        });

        this.documentsService
          .getAllUploadedBulletins()
          .subscribe((bulletins) => {
            console.log('Bulletins:', bulletins);
            const bulletinDocs = bulletins.map((bulletin) => {
              return {
                id: bulletin.id,
                type: 'bulletin' as const,
                date: bulletin.uploaded_at || new Date().toISOString(),
                status: bulletin.status || 'verified',
              };
            });

            this.documents = [...ordonnanceDocs, ...bulletinDocs];
            this.filteredDocuments = this.documents;
            this.isLoadingData = false;

            // Calculate stats
            this.calculateStats();
          });
      });
  }

  calculateStats() {
    this.totalDocuments = this.documents.length;

    // Count ordonnances and bulletins
    this.ordonnancesCount = this.documents.filter(
      (doc) => doc.type === 'prescription'
    ).length;
    this.bulletinsCount = this.documents.filter(
      (doc) => doc.type === 'bulletin'
    ).length;

    // Count pending ordonnances
    this.pendingOrdonnances = this.documents.filter(
      (doc) => doc.type === 'prescription' && doc.status === 'pending'
    ).length;

    // Count flagged bulletins
    this.flaggedBulletins = this.documents.filter(
      (doc) => doc.type === 'bulletin' && doc.status === 'flagged'
    ).length;

    // Count documents from the last 7 days
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    this.newDocumentsThisWeek = this.documents.filter((doc) => {
      const docDate = new Date(doc.date);
      return docDate >= oneWeekAgo;
    }).length;
  }

  applyFilters() {
    const searchTerm =
      this.filterForm.get('searchTerm')?.value?.toLowerCase() || '';
    const typeFilter = this.filterForm.get('type')?.value || 'all';
    const statusFilter = this.filterForm.get('status')?.value || 'all';
    const dateFilter = this.filterForm.get('date')?.value || 'all';

    // Filter couriers
    this.filteredCouriers = this.couriers.filter((courier) => {
      // Search term filter (search in matricule, adherent name or beneficiary name)
      const matchesSearch =
        searchTerm === '' ||
        courier.mat_fiscale?.toLowerCase().includes(searchTerm) ||
        courier.nom_complet_adherent?.toLowerCase().includes(searchTerm) ||
        courier.nom_complet_beneficiaire?.toLowerCase().includes(searchTerm);

      // Type filter
      let matchesType = true;
      if (typeFilter !== 'all') {
        const hasOrdonnances = courier.files?.some(
          (file) => file.type === 'prescription'
        );
        const hasBulletins = courier.files?.some(
          (file) => file.type === 'bulletin'
        );

        if (typeFilter === 'prescription') {
          matchesType = hasOrdonnances;
        } else if (typeFilter === 'care') {
          matchesType = hasBulletins;
        }
      }

      // Date filter
      let matchesDate = true;
      if (dateFilter !== 'all') {
        const courierDate = new Date(courier.created_at);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (dateFilter === 'today') {
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);
          matchesDate = courierDate >= today && courierDate < tomorrow;
        } else if (dateFilter === 'this-week') {
          const weekAgo = new Date();
          weekAgo.setDate(weekAgo.getDate() - 7);
          matchesDate = courierDate >= weekAgo;
        } else if (dateFilter === 'this-month') {
          const monthAgo = new Date();
          monthAgo.setMonth(monthAgo.getMonth() - 1);
          matchesDate = courierDate >= monthAgo;
        }
      }

      return matchesSearch && matchesType && matchesDate;
    });

    // Reset expanded rows when filters change
    this.expandedRows = new Array(this.filteredCouriers.length).fill(false);

    // Filter documents (keep this for backward compatibility)
    this.filteredDocuments = this.documents.filter((doc) => {
      // Search filter - removed patient reference
      const matchesSearch = !searchTerm;

      // Type filter
      const matchesType =
        typeFilter === 'all' ||
        (typeFilter === 'prescription' && doc.type === 'prescription') ||
        (typeFilter === 'care' && doc.type === 'bulletin');

      // Status filter
      const matchesStatus =
        statusFilter === 'all' || doc.status === statusFilter;

      // Date filter
      let matchesDate = true;
      if (dateFilter !== 'all') {
        const docDate = new Date(doc.date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (dateFilter === 'today') {
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);
          matchesDate = docDate >= today && docDate < tomorrow;
        } else if (dateFilter === 'this-week') {
          const weekAgo = new Date();
          weekAgo.setDate(weekAgo.getDate() - 7);
          matchesDate = docDate >= weekAgo;
        } else if (dateFilter === 'this-month') {
          const monthAgo = new Date();
          monthAgo.setMonth(monthAgo.getMonth() - 1);
          matchesDate = docDate >= monthAgo;
        }
      }

      return matchesSearch && matchesType && matchesStatus && matchesDate;
    });
  }

  // Helper methods to count documents by type for each courier
  countOrdonnances(courier: Courier): number {
    return (
      courier.files?.filter((file) => file.type === 'prescription').length || 0
    );
  }

  countBulletins(courier: Courier): number {
    return (
      courier.files?.filter((file) => file.type === 'bulletin').length || 0
    );
  }

  getLatestDocumentDate(courier: Courier): string {
    if (!courier.files || courier.files.length === 0) {
      return courier.created_at;
    }

    const dates = courier.files.map(
      (file) => new Date(file.uploaded_at || courier.created_at)
    );
    const latestDate = new Date(
      Math.max(...dates.map((date) => date.getTime()))
    );
    return latestDate.toISOString();
  }

  openExtractedInNewTab(id: number) {
    this.router.navigateByUrl(`/courriers/${id}/extracted`);
  }

  // Row expansion methods
  toggleRowExpansion(index: number, event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    this.expandedRows[index] = !this.expandedRows[index];
    const courier = this.filteredCouriers[index];
    if (this.expandedRows[index]) {
      // When the row becomes visible, show its upload section by default
      this.showUploadSection[courier.id] = true;
    } else {
      // If user collapses, hide the upload section
      this.showUploadSection[courier.id] = false;
    }
  }

  // Get documents for a specific courier
  getDocuments(courierId: number): DocumentDetail[] {
    const courier = this.couriers.find((c) => c.id === courierId);
    if (!courier || !courier.files) {
      return [];
    }

    return courier.files.map((file) => {
      console.log('file type:', file.type);
      return {
        id: file.id,
        type: file.type,
        fileName: file.original_name || file.filename,
        fileSize: this.formatFileSize(file.size_in_bytes ?? 0),
        date: file.uploaded_at,
        is_verified: file.is_verified || false,
        status: this.getFileStatus(file.type), // You might want to add actual status to file object
      };
    });
  }

  // Helper method to format file size (placeholder implementation)
  public formatFileSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    const kb = bytes / 1024;
    if (kb < 1024) {
      // show one decimal place
      return `${kb.toFixed(1)} KB`;
    }
    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB`;
  }

  // Helper method to get file status (placeholder implementation)
  private getFileStatus(fileType: string): string {
    // This is a placeholder - you might want to get actual status from backend
    return fileType === 'prescription' ? 'verified' : 'pending';
  }

  // Helper method to get status CSS class
  getStatusClass(status: string): string {
    const statusLower = status.toLowerCase();
    switch (statusLower) {
      case 'verified':
        return 'status verified';
      case 'pending':
        return 'status pending';
      case 'flagged':
        return 'status flagged';
      case 'missed':
        return 'status missed';
      default:
        return 'status';
    }
  }

  canAddMoreFiles(courierId: number): boolean {
    return (this.uploadFiles[courierId]?.length || 0) < this.MAX_FILES;
  }
  hasFilesToUpload(courierId: number): boolean {
    return (this.uploadFiles[courierId]?.length || 0) > 0;
  }

  onDragOver(evt: DragEvent, courierId: number) {
    evt.preventDefault();
    this.isDragOver[courierId] = true;
  }
  onDragLeave(evt: DragEvent, courierId: number) {
    evt.preventDefault();
    this.isDragOver[courierId] = false;
  }
  onDrop(evt: DragEvent, courierId: number) {
    evt.preventDefault();
    this.isDragOver[courierId] = false;
    const files = Array.from(evt.dataTransfer!.files as FileList);
    this.handleFilesForCourier(files, courierId);
  }

  onFileSelected(evt: Event, courierId: number) {
    const input = evt.target as HTMLInputElement;
    if (!input.files) return;
    const files = Array.from(input.files);
    this.handleFilesForCourier(files, courierId);
    input.value = '';
  }

  private handleFilesForCourier(files: File[], courierId: number) {
    if (!this.uploadFiles[courierId]) {
      this.uploadFiles[courierId] = [];
    }
    const slots = this.MAX_FILES - this.uploadFiles[courierId].length;
    files.slice(0, slots).forEach(async (f) => {
      if (!['image/jpeg', 'image/png', 'application/pdf'].includes(f.type)) {
        return alert(`Unsupported type: ${f.name}`);
      }
      // For PDFs, start with a generic icon until thumbnails are ready
      const preview =
        f.type === 'application/pdf'
          ? '/assets/PDF_icon.svg'
          : URL.createObjectURL(f);

      // Create a new upload‐bucket item
      const newItem = {
        file: f,
        preview,
        thumbnails: undefined as string[] | undefined,
        status: 'pending' as 'pending' | 'uploading' | 'success' | 'error',
      };

      this.uploadFiles[courierId].push(newItem);

      // If it's a PDF, generate actual page‐thumbnails asynchronously
      if (f.type === 'application/pdf') {
        try {
          await this.generatePdfThumbnails(newItem);
          // Once thumbnails exist, you could override preview or let template pick thumbnails[0].
          // For instance, if you want the first page as the “main preview”:
          if (newItem.thumbnails && newItem.thumbnails.length > 0) {
            newItem.preview = newItem.thumbnails[0];
          }
        } catch (e) {
          console.error('Could not generate PDF thumbs', e);
        }
      }
    });
  }

  removeFile(courierId: number, idx: number) {
    URL.revokeObjectURL(this.uploadFiles[courierId][idx].preview);
    this.uploadFiles[courierId].splice(idx, 1);
  }

  onCancelUpload(courierId: number, evt: Event) {
    evt.stopPropagation();
    this.uploadFiles[courierId].forEach((u) => URL.revokeObjectURL(u.preview));
    this.uploadFiles[courierId] = [];
  }

  uploadFiles_forCourier(courierId: number) {
    const bucket = this.uploadFiles[courierId] || [];
    if (!bucket.length) return;

    // mark each as “uploading”
    bucket.forEach((u) => (u.status = 'uploading'));

    this.documentsService
      .uploadAndParseFilesForCourier(
        courierId,
        bucket.map((u) => u.file)
      )
      .subscribe({
        next: (updatedCourier: Courier) => {
          // on success, mark as “success”
          bucket.forEach((u) => (u.status = 'success'));

          // update local state:
          const idx = this.couriers.findIndex((c) => c.id === courierId);
          if (idx !== -1) {
            this.couriers[idx] = updatedCourier;
            this.applyFilters();
          }

          // after a short delay, clear the upload bucket & hide the upload area
          setTimeout(() => {
            this.uploadFiles[courierId] = [];
            this.showUploadSection[courierId] = false;
          }, 500);
        },
        error: (_) => {
          bucket.forEach((u) => (u.status = 'error'));
        },
      });
  }

  // Helper method to get status display text
  getStatusText(status: string): string {
    const statusLower = status.toLowerCase();
    switch (statusLower) {
      case 'verified':
        return 'Vérifié';
      case 'pending':
        return 'En attente';
      case 'flagged':
        return 'Signalé';
      case 'missed':
        return 'Manqué';
      default:
        return status;
    }
  }

  openUploadModal() {
    const dialogRef = this.dialog.open(UploadDocComponent, {
      width: '80%',
      maxWidth: '1000px',
      height: '90%',
      maxHeight: '1000px',
    });

    // Optional: refresh data when the dialog is closed
    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.loadAllDocuments();
        this.loadAllCouriers();
      }
    });
  }

  viewDocument(courierId: number, event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    this.router.navigate(['/couriers', courierId]);
  }

  editDocument(courierId: number, event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    this.router.navigate([`/couriers/${courierId}/edit`]);
  }

  viewDocumentDetails(documentId: number, event?: Event) {
    if (event) {
      event.stopPropagation();
    }

    // Construct the PDF URL using your new endpoint
    const pdfUrl = `http://localhost:8000/api/files/${documentId}`;

    // Open PDF in new tab
    window.open(pdfUrl, '_blank');
  }

  // Alternative method if you want to handle errors gracefully

  deleteDocument(fileId: number, event?: Event) {
    if (event) {
      // Prevent the row‐expansion click from firing
      event.stopPropagation();
    }

    // 1) Open your ConfirmDialogComponent. We pass in a small object with `message`.
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '360px',
      data: {
        message: 'ce document', // ← this text will appear inside “Delete {{ data.message }}?”
      },
    });

    // 2) Once the user either “Delete” or “Cancel” is clicked, afterClosed() emits true/false.
    dialogRef.afterClosed().subscribe((confirmed: boolean) => {
      // If confirmed === true, user clicked Delete
      if (!confirmed) {
        return;
      }

      // 3) Call your service to actually delete from the backend
      this.documentsService.deleteFile(fileId).subscribe({
        next: () => {
          // 4) And if successful, remove that file from the courier’s files array in memory:
          for (let courier of this.couriers) {
            const idx = courier.files.findIndex((f) => f.id === fileId);
            if (idx !== -1) {
              courier.files.splice(idx, 1);
              break;
            }
          }
          // Re‐apply any filters if needed:
          this.filteredCouriers = this.couriers.filter((c) => true);
        },
        error: (err) => {
          console.error('Error deleting file', err);
          alert('Impossible de supprimer le document. Veuillez réessayer.');
        },
      });
    });
  }
}
