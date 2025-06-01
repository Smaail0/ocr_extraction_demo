// extracted-container.component.ts
import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
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

  loadedBulletin: Bulletin | null = null;
  loadedPrescription: Prescription | null = null;

  constructor(
    private router: Router,
    private documentsService: DocumentsService
  ) {}

  ngOnInit() {
    const nav =
      this.router.getCurrentNavigation()?.extras.state ?? history.state;
    this.files = nav.files || [];
    this.selectedIndex = nav.selectedIndex || 0;

    this.loadCurrent();
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
    const tab = this.files[this.selectedIndex];
    if (tab.type === 'bulletin') {
      this.documentsService.getBulletinById(tab.docId).subscribe((fresh) => {
        this.loadedBulletin = fresh;
      });
    } else {
      this.documentsService
        .getPrescriptionById(tab.docId)
        .subscribe((fresh) => {
          this.loadedPrescription = fresh;
        });
    }
  }
}
