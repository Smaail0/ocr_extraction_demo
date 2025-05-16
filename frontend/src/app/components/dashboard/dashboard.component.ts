import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DocumentsService } from '../../services/documents.service';
import { Router } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, catchError } from 'rxjs/operators';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { Observable, of } from 'rxjs';

import { ExtractedContainerComponent } from '../extracted-tabs/extracted-container.component';
import { UploadDocComponent } from '../upload-doc/upload-doc.component';

interface Document {
  id: number;
  patient_name?: string;
  patient_id?: string;
  type: 'ordonnance' | 'bulletin';
  date: string;
  status: 'verified' | 'pending' | 'flagged';
}

interface Patient {
  id: number;
  first_name?: string;
  last_name?: string;
  patient_id?: string;
  documents?: Document[];
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatDialogModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css'],
})
export class DashboardComponent implements OnInit {
  documents: Document[] = [];
  filteredDocuments: Document[] = [];
  selectedPatient: Patient | null = null;
  isLoadingPatient = false;

  // Stats
  totalDocuments = 0;
  ordonnancesCount = 0;
  pendingOrdonnances = 0;
  bulletinsCount = 0;
  flaggedBulletins = 0;
  newDocumentsThisWeek = 0;

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
    this.testPatientService();
    this.getPatientData(2); // Test with a known patient ID

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

  getPatientData(patientId: number) {
    console.log('Fetching patient data for ID:', patientId);
    this.isLoadingPatient = true;
    this.documentsService.getPatientWithDocs(patientId).subscribe({
      next: (patient) => {
        console.log('Raw patient data received:', patient);
        this.selectedPatient = patient;
        this.isLoadingPatient = false;

        // Update patient information in the documents array for consistent display
        if (patient) {
          const fullName = `${patient.first_name || ''} ${
            patient.last_name || ''
          }`.trim();
          this.documents = this.documents.map((doc) => {
            if (doc.patient_id === patient.patient_id) {
              return { ...doc, patient_name: fullName };
            }
            return doc;
          });
          // Update filtered documents as well
          this.applyFilters();
        }
      },
      error: (err) => {
        console.error('Patient not found or error occurred', err);
        this.isLoadingPatient = false;
        // Handle error in UI
      },
    });
  }

  loadAllDocuments() {
    console.log('Starting to load documents');

    this.documentsService
      .getAllUploadedOrdonnances()
      .subscribe((ordonnances) => {
        console.log('Raw ordonnances data:', ordonnances);

        if (ordonnances.length > 0) {
          console.log('Sample ordonnance fields:', Object.keys(ordonnances[0]));
        }

        const ordonnanceDocs = ordonnances.map((ord) => {
          // Construct patient name safely, handling non-Latin characters
          const fullName =
            ord.first_name && ord.last_name
              ? `${ord.first_name} ${ord.last_name}`.trim()
              : ord.first_name ||
                ord.last_name ||
                `Patient ${ord.id || 'Sans Nom'}`;

          return {
            id: ord.id,
            patient_name: fullName,
            patient_id: ord.patient_id || (ord.id ? ord.id.toString() : 'N/A'),
            type: 'ordonnance' as const,
            date: ord.uploaded_at || new Date().toISOString(),
            status: ord.status || 'pending',
          };
        });

        this.documentsService
          .getAllUploadedBulletins()
          .subscribe((bulletins) => {
            console.log('Bulletins:', bulletins);
            const bulletinDocs = bulletins.map((bulletin) => {
              // Construct patient name safely for bulletins too
              const fullName =
                bulletin.prenom && bulletin.nom
                  ? `${bulletin.prenom} ${bulletin.nom}`.trim()
                  : bulletin.prenom ||
                    bulletin.nom ||
                    `Patient ${bulletin.id || 'Sans Nom'}`;

              return {
                id: bulletin.id,
                patient_name: fullName,
                patient_id:
                  bulletin.patient_id ||
                  (bulletin.id ? bulletin.id.toString() : 'N/A'),
                type: 'bulletin' as const,
                date: bulletin.uploaded_at || new Date().toISOString(),
                status: bulletin.status || 'verified',
              };
            });

            this.documents = [...ordonnanceDocs, ...bulletinDocs];

            // Fetch patient information for documents that are missing names
            this.ensurePatientInformation();

            this.filteredDocuments = this.documents;

            // Calculate stats
            this.calculateStats();
          });
      });
  }

  ensurePatientInformation() {
    // Identify documents that are missing patient names but have IDs
    const documentsNeedingInfo = this.documents.filter(
      (doc) =>
        (!doc.patient_name ||
          doc.patient_name.includes('Patient #') ||
          doc.patient_name.includes('Sans Nom')) &&
        doc.patient_id &&
        doc.patient_id !== 'N/A'
    );

    // For each document needing info, fetch the patient data
    documentsNeedingInfo.forEach((doc) => {
      if (doc.patient_id) {
        this.documentsService
          .getPatientWithDocs(Number(doc.patient_id))
          .pipe(
            catchError(() => of(null)) // Silently fail if we can't get the patient info
          )
          .subscribe((patient) => {
            if (patient) {
              // Compose full name from patient data
              const fullName = `${patient.first_name} ${patient.last_name}`;

              // Find document to update
              const docIndex = this.documents.findIndex(
                (d) => d.patient_id === patient.patient_id
              );
              if (docIndex !== -1) {
                this.documents[docIndex].patient_name = fullName;
                // Also update filteredDocuments similarly if separate array
                const filteredIndex = this.filteredDocuments.findIndex(
                  (d) => d.patient_id === patient.patient_id
                );
                if (filteredIndex !== -1) {
                  this.filteredDocuments[filteredIndex].patient_name = fullName;
                }
              }
            }
          });
      }
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

    this.filteredDocuments = this.documents.filter((doc) => {
      // Search filter
      const matchesSearch =
        !searchTerm ||
        doc.patient_name?.toLowerCase().includes(searchTerm) ||
        doc.patient_id?.toLowerCase().includes(searchTerm);

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
  // Add a test method
  testPatientService() {
    // Pick a patient ID you know exists
    const testId = 2; // Replace with a real ID
    console.log(`Testing patient service with ID: ${testId}`);

    this.documentsService.getPatientWithDocs(testId).subscribe({
      next: (patient) => {
        console.log('Test patient data:', patient);
        alert(`Patient name: ${patient.first_name} ${patient.last_name}`);
      },
      error: (err) => {
        console.error('Test patient fetch failed:', err);
        alert('Failed to fetch patient data');
      },
    });
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
      }
    });
  }

  viewDocument(documentId: number, patientId: string | undefined) {
    if (patientId) {
      this.getPatientData(Number(patientId));
    }
    this.router.navigate(['/extracted']);
  }

  editDocument(documentId: number, type: string) {
    this.router.navigate([`/documents/${type}/${documentId}/edit`]);
  }
}
