import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { CourierService } from '../../services/courier.service';
import { Courier } from '../../models/courier.model';
import { Prescription } from '../../models/prescription.model';
import { Bulletin } from '../../models/bulletin.model';

import { ExtractedTabsComponent } from '../extracted-tabs/extracted-tabs.component';
import { PrescriptionComponent } from '../prescription/prescription.component';
import { BulletinComponent } from '../bulletin/bulletin.component';

interface FileUpload {
  id: number;
  filename: string;
  original_name: string;
  type: 'prescription' | 'bulletin';

  prescription_id?: number | null;
  bulletin_id?: number | null;
}

interface TabDoc {
  header: { documentType: string; filename: string };
  docId: number;
  uploadId: number;
}

@Component({
  selector: 'app-courier-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ExtractedTabsComponent,
    PrescriptionComponent,
    BulletinComponent,
  ],
  templateUrl: './courier-detail.component.html',
  styleUrls: ['./courier-detail.component.css'],
})
export class CourierDetailComponent implements OnInit {
  courier!: Courier;
  tabs: TabDoc[] = [];
  loadedPrescription!: Prescription;
  loadedBulletin!: Bulletin;
  selectedIndex = 0;
  isLoading = true;
  errorMessage = '';
  noExtractedData = false;

  constructor(
    private route: ActivatedRoute,
    private courierService: CourierService
  ) {}

  ngOnInit() {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.courierService.getCourier(id).subscribe({
      next: (c) => {
        this.courier = c;

        // 1) only keep the files with a real FK
        const saved = c.files.filter(
          (f) => f.bulletin_id != null || f.prescription_id != null
        );

        // 2) turn them into tabs
        this.tabs = saved.map((f) => ({
          header:
            f.bulletin_id != null
              ? { documentType: 'bulletin_de_soin', filename: f.original_name }
              : { documentType: 'prescription', filename: f.original_name },
          docId: f.bulletin_id != null ? f.bulletin_id! : f.prescription_id!,
          uploadId: f.id, // <-- this is the FileUpload row id
        }));

        if (this.tabs.length) {
          this.tabs.forEach((_, idx) => this.loadTab(idx));
          this.selectedIndex = 0;
        } else {
          this.noExtractedData = true;
        }

        this.isLoading = false;
      },
      error: (err) => {
        /* … */
      },
    });
  }

  onTabChange(idx: number) {
    this.selectedIndex = idx;
    this.loadTab(idx);
  }

  private loadTab(idx: number) {
    const tab = this.tabs[idx];
    if (!tab || !tab.docId) {
      this.isLoading = false;
      return;
    }

    if (tab.header.documentType === 'prescription') {
      this.courierService.getPrescription(tab.docId).subscribe({
        next: (p) => {
          this.loadedPrescription = p;
          this.isLoading = false;
        },
      });
    } else {
      this.courierService.getBulletin(tab.docId).subscribe({
        next: (b) => {
          this.loadedBulletin = b;
          this.isLoading = false;
        },
      });
    }
  }
}
