import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DocumentsService } from '../../services/documents.service';
import { Router } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { debounceTime } from 'rxjs/operators';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';

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

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatDialogModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit {

  documents: Document[] = [];
  filteredDocuments: Document[] = [];
  
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
    date: new FormControl('all')
  });

  constructor(private documentsService: DocumentsService,private router: Router, private dialog: MatDialog) {}

  ngOnInit(): void {
    this.loadAllDocuments();
    this.getPatientData();
    

    this.filterForm.get('searchTerm')?.valueChanges
      .pipe(debounceTime(300))
      .subscribe(() => this.applyFilters());
      
    this.filterForm.get('type')?.valueChanges.subscribe(() => this.applyFilters());
    this.filterForm.get('status')?.valueChanges.subscribe(() => this.applyFilters());
    this.filterForm.get('date')?.valueChanges.subscribe(() => this.applyFilters());
  }

  getPatientData() {
  const firstName = '';
  const lastName = '';

  this.documentsService.getPatientWithDocs(firstName, lastName).subscribe({
    next: patient => {
      console.log('Patient with documents:', patient);
      // Optionally, update some local state or UI here
    },
    error: err => {
      console.error('Patient not found or error occurred', err);
    }
  });
}
  loadAllDocuments() {
    this.documentsService.getAllUploadedOrdonnances().subscribe(ordonnances => {
      console.log('Ordonnances:', ordonnances); 
    const ordonnanceDocs = ordonnances.map(ord => {
    const fullName = `${ord.first_name || ''} ${ord.last_name || ''}`.trim();
    return {
      id: ord.id,
      patient_name: fullName || `Patient ${ord.id}`,
      patient_id: ord.patient_id,
      type: 'ordonnance' as const,
      date: ord.uploaded_at || new Date().toISOString(),
      status: ord.status || 'pending'
  };
});
      
    this.documentsService.getAllUploadedBulletins().subscribe(bulletins => {
      console.log('Bulletins:', bulletins);
    const bulletinDocs = bulletins.map(bulletin => {
      const fullName = `${bulletin.prenom || ''} ${bulletin.nom || ''}`.trim();
      return {
        id: bulletin.id,
        patient_name: fullName || `Patient ${bulletin.id || 'Sans Nom'}`,
        patient_id: bulletin.patient_id || bulletin.id?.toString() || 'N/A',
        type: 'bulletin' as const,
        date: bulletin.uploaded_at || new Date().toISOString(),
        status: bulletin.status || 'verified'
      };
    });
        
        this.documents = [...ordonnanceDocs, ...bulletinDocs];
        this.filteredDocuments = this.documents;
        
        // Calculate stats
        this.calculateStats();
      });
    });
  }

  calculateStats() {
    this.totalDocuments = this.documents.length;
    
    // Count ordonnances and bulletins
    this.ordonnancesCount = this.documents.filter(doc => doc.type === 'ordonnance').length;
    this.bulletinsCount = this.documents.filter(doc => doc.type === 'bulletin').length;
    
    // Count pending ordonnances
    this.pendingOrdonnances = this.documents.filter(doc => 
      doc.type === 'ordonnance' && doc.status === 'pending'
    ).length;
    
    // Count flagged bulletins
    this.flaggedBulletins = this.documents.filter(doc => 
      doc.type === 'bulletin' && doc.status === 'flagged'
    ).length;
    
    // Count documents from the last 7 days
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    this.newDocumentsThisWeek = this.documents.filter(doc => {
      const docDate = new Date(doc.date);
      return docDate >= oneWeekAgo;
    }).length;
  }

  applyFilters() {
    const searchTerm = this.filterForm.get('searchTerm')?.value?.toLowerCase() || '';
    const typeFilter = this.filterForm.get('type')?.value || 'all';
    const statusFilter = this.filterForm.get('status')?.value || 'all';
    const dateFilter = this.filterForm.get('date')?.value || 'all';
    
    this.filteredDocuments = this.documents.filter(doc => {
      // Search filter
      const matchesSearch = !searchTerm || 
        (doc.patient_name?.toLowerCase().includes(searchTerm) || 
         doc.patient_id?.toLowerCase().includes(searchTerm));
      
      // Type filter
      const matchesType = typeFilter === 'all' || 
        (typeFilter === 'prescription' && doc.type === 'ordonnance') || 
        (typeFilter === 'care' && doc.type === 'bulletin');
      
      // Status filter
      const matchesStatus = statusFilter === 'all' || doc.status === statusFilter;
      
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

  openUploadModal() {
    this.dialog.open(UploadDocComponent, {
      width: '80%',
      maxWidth: '1000px',
      height: '90%',
      maxHeight: '1000px'
    });
  }

  viewDocument() {
    this.router.navigate(['/extracted']);
  }

  editDocument(documentId: number, type: string) {
    this.router.navigate([`/documents/${type}/${documentId}/edit`]);
  }
}