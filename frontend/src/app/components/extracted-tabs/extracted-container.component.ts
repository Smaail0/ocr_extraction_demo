import { Component, OnInit } from '@angular/core';
import { Router }            from '@angular/router';
import { CommonModule }      from '@angular/common';

import { ExtractedTabsComponent } from './extracted-tabs.component';
import { UploadDocComponent }     from '../upload-doc/upload-doc.component';
import { PrescriptionComponent }  from '../prescription/prescription.component';
import { BulletinComponent }      from '../bulletin/bulletin.component';

@Component({
  selector: 'app-extracted-container',
  standalone: true,
  imports: [
    CommonModule,
    ExtractedTabsComponent,
    UploadDocComponent,
    PrescriptionComponent,
    BulletinComponent
  ],
  templateUrl: './extracted-container.component.html',
  styleUrls: ['./extracted-container.component.css']
})
export class ExtractedContainerComponent implements OnInit {
  files: any[] = [];
  selectedIndex = 0;
  addingMore = false;

  constructor(private router: Router) {}

  ngOnInit() {
    const nav = this.router.getCurrentNavigation()?.extras.state
             ?? history.state;
    this.files         = nav.files || [];
    this.selectedIndex = nav.selectedIndex ?? 0;

    if (!this.files.length) {
      this.router.navigate(['/']);
    }
  }

  // called by the [+] button
  onAddMore() {
    this.addingMore = true;
  }

  // called by UploadDocComponent.extracted
  onNewDocuments(newDocs: any[]) {
    // append to existing tabs
    this.files.push(...newDocs);
    // select the first newly added one (or whatever index you prefer)
    this.selectedIndex = this.files.length - newDocs.length;
    this.addingMore = false;
  }

  onTabSelected(i: number) {
    this.selectedIndex = i;
  }

  get currentDoc() {
    return this.files[this.selectedIndex];
  }
}
