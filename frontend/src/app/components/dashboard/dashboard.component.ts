import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DocumentsService } from '../../services/documents.service';
import { Router } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, catchError } from 'rxjs/operators';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';

import { Observable, of } from 'rxjs';

import { UploadDocComponent } from '../upload-doc/upload-doc.component';
import { ConfirmDialogComponent } from '../../confirm-dialog/confirm-dialog.component';

interface Document {
  id: number;
  type: 'ordonnance' | 'bulletin';
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
}

interface Courier {
  id: number;
  matricule: string;
  nom_complet_adherent: string;
  nom_complet_beneficiaire: string;
  files: {
    id: number;
    type: string;
    filename: string;
    original_name: string;
    path: string;
    uploaded_at: string;
  }[];
  created_at: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatDialogModule, ConfirmDialogComponent],
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

  constructor(
    private documentsService: DocumentsService,
    private router: Router,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
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
        // Initialize expanded rows array
        this.expandedRows = new Array(courriers.length).fill(false);
        this.isLoadingData = false;
        this.calculateStats(); // Recalculate stats after loading couriers
      },
      error: (error) => {
        console.error('Error loading couriers:', error);
        this.isLoadingData = false;
      }
    });
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
            type: 'ordonnance' as const,
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
      (doc) => doc.type === 'ordonnance'
    ).length;
    this.bulletinsCount = this.documents.filter(
      (doc) => doc.type === 'bulletin'
    ).length;

    // Count pending ordonnances
    this.pendingOrdonnances = this.documents.filter(
      (doc) => doc.type === 'ordonnance' && doc.status === 'pending'
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
      const matchesSearch = searchTerm === '' || 
        courier.matricule?.toLowerCase().includes(searchTerm) ||
        courier.nom_complet_adherent?.toLowerCase().includes(searchTerm) ||
        courier.nom_complet_beneficiaire?.toLowerCase().includes(searchTerm);

      // Type filter
      let matchesType = true;
      if (typeFilter !== 'all') {
        const hasOrdonnances = courier.files?.some(file => file.type === 'ordonnance');
        const hasBulletins = courier.files?.some(file => file.type === 'bulletin');
        
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
        (typeFilter === 'prescription' && doc.type === 'ordonnance') ||
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
    return courier.files?.filter(file => file.type === 'ordonnance').length || 0;
  }
  
  countBulletins(courier: Courier): number {
    return courier.files?.filter(file => file.type === 'bulletin').length || 0;
  }
  
  getLatestDocumentDate(courier: Courier): string {
    if (!courier.files || courier.files.length === 0) {
      return courier.created_at;
    }
    
    const dates = courier.files.map(file => new Date(file.uploaded_at || courier.created_at));
    const latestDate = new Date(Math.max(...dates.map(date => date.getTime())));
    return latestDate.toISOString();
  }

  // Row expansion methods
  toggleRowExpansion(index: number, event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    this.expandedRows[index] = !this.expandedRows[index];
  }

  // Get documents for a specific courier
  getDocuments(courierId: number): DocumentDetail[] {
    const courier = this.couriers.find(c => c.id === courierId);
    if (!courier || !courier.files) {
      return [];
    }

    return courier.files.map(file => ({
      id: file.id,
      type: file.type === 'ordonnance' ? 'Ordonnance' : 'Bulletin de soins',
      fileName: file.original_name || file.filename,
      fileSize: this.formatFileSize(file.path), // You might want to store actual file size
      date: file.uploaded_at,
      status: this.getFileStatus(file.type) // You might want to add actual status to file object
    }));
  }

  // Helper method to format file size (placeholder implementation)
  private formatFileSize(filePath: string): string {
    // This is a placeholder - you might want to get actual file size from backend
    return '-- KB';
  }

  // Helper method to get file status (placeholder implementation)
  private getFileStatus(fileType: string): string {
    // This is a placeholder - you might want to get actual status from backend
    return fileType === 'ordonnance' ? 'verified' : 'pending';
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

viewCourier(courierId: number, event?: Event) {
    if (event) {
      event.stopPropagation();
    }

    this.documentsService.getCourierById(courierId).subscribe({
      next: (data) => {
        console.log('Courier data:', data);
        this.router.navigate(['/extracted']);
      },
      error: (err) => {
        console.error('Error fetching document:', err);
      }
    });
  }


viewPdfDocument(documentId: number, event?: Event) {
  if (event) {
    event.stopPropagation();
  }

  const pdfUrl = `http://localhost:8000/api/files/${documentId}`;
  window.open(pdfUrl, '_blank');
}

deleteDocument(documentId: number, event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '500px',
   
      data: {
        title: 'Confirmation de suppression',
        message: 'Êtes-vous sûr de vouloir supprimer ce document ?'
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result === true) {
        this.documentsService.deleteFile(documentId).subscribe({
          next: () => {
            console.log('Document deleted successfully');
            this.loadAllDocuments();
          },
          error: (error) => {
            console.error('Error deleting document:', error);
          }
        });
      }
    });
  }
}