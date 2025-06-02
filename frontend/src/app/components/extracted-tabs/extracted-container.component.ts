// extracted-container.component.ts
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';

import { ExtractedTabsComponent } from './extracted-tabs.component';
import { UploadDocComponent } from '../upload-doc/upload-doc.component';
import { PrescriptionComponent } from '../prescription/prescription.component';
import { BulletinComponent } from '../bulletin/bulletin.component';

import { Prescription } from '../../models/prescription.model';
import { Bulletin } from '../../models/bulletin.model';
import { DocumentsService } from '../../services/documents.service';
import { switchMap, map } from 'rxjs/operators';

interface ExtractedTab {
  id: number; // file_upload PK
  docId: number; // bulletin_id or prescription_id
  type: 'bulletin' | 'prescription';
  // …plus all of your parsed fields…
}

@Component({
  selector: 'app-extracted-container',
  standalone: true,
  imports: [
    CommonModule,
    ExtractedTabsComponent,
    UploadDocComponent,
    PrescriptionComponent,
    BulletinComponent,
  ],
  templateUrl: './extracted-container.component.html',
})
export class ExtractedContainerComponent implements OnInit {
  files: ExtractedTab[] = [];
  selectedIndex = 0;
  addingMore = false;
  isLoading = false;

  courierId!: number;

  loadedBulletin: Bulletin | null = null;
  loadedPrescription: Prescription | null = null;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private documentsService: DocumentsService
  ) {}

  ngOnInit() {
    // 1) Read any provided navigation state (router.navigate({ state: { files, selectedIndex } }))
    const navState =
      this.router.getCurrentNavigation()?.extras.state ?? history.state;

    // 2) Read the :id parameter from the URL
    this.courierId = Number(this.route.snapshot.paramMap.get('id'));

    if (
      Array.isArray(navState.files) &&
      (navState.files as ExtractedTab[]).length > 0
    ) {
      // If we have “files” passed via router.state, just re‐use them:
      this.files = navState.files as ExtractedTab[];
      this.selectedIndex = navState.selectedIndex || 0;
      // Load the detail for the first tab:
      this.loadCurrent();
    } else {
      // No router.state.files → fetch from the server
      this.fetchFilesFromServer();
    }
  }

  private fetchFilesFromServer() {
    this.isLoading = true;

    this.documentsService.getCourierById(this.courierId).subscribe({
      next: (courier) => {
        // We expect courier.files to be an array of FileUpload-like objects,
        // which we coerce into ExtractedTab[] for simplicity here.
        // Adjust field‐mapping as needed if your backend gives slightly different keys.
        this.files = (courier.files || []).map((f) => ({
          id: f.id,
          docId: f.prescription_id ?? f.bulletin_id!,
          type: f.type as 'bulletin' | 'prescription',
        }));
        this.selectedIndex = 0;
        this.loadCurrent();
      },
      error: (_) => {
        console.error(`Failed to load courier ${this.courierId}`);
        this.files = [];
        this.isLoading = false;
      },
    });
  }

  onAddMore() {
    this.addingMore = true;
  }

  onNewDocuments(newDocs: ExtractedTab[]) {
    this.files.push(...newDocs);
    this.selectedIndex = this.files.length - newDocs.length;
    this.addingMore = false;
    this.loadCurrent();
  }

  onTabSelected(i: number) {
    this.selectedIndex = i;

    this.loadedPrescription = null;
    this.loadedBulletin = null;

    this.loadCurrent();
  }

  public loadCurrent() {
    if (!this.files.length) {
      this.isLoading = false;
      return;
    }

    this.isLoading = true;
    const tab = this.files[this.selectedIndex];

    if (tab.type === 'bulletin') {
      this.documentsService.getBulletinById(tab.docId).subscribe({
        next: (fresh) => {
          this.loadedBulletin = fresh;
          this.loadedPrescription = null;
          this.isLoading = false;
        },
        error: (_) => {
          console.error(`Error fetching bulletin ${tab.docId}`);
          this.loadedBulletin = null;
          this.isLoading = false;
        },
      });
    } else {
      this.documentsService.getPrescriptionById(tab.docId).subscribe({
        next: (fresh) => {
          this.loadedPrescription = fresh;
          this.loadedBulletin = null;
          this.isLoading = false;
        },
        error: (_) => {
          console.error(`Error fetching prescription ${tab.docId}`);
          this.loadedPrescription = null;
          this.isLoading = false;
        },
      });
    }
  }
}
