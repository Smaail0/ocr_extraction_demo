import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router }            from '@angular/router';
import { CommonModule }      from '@angular/common';

import { ExtractedTabsComponent } from './extracted-tabs.component';
import { UploadDocComponent }     from '../upload-doc/upload-doc.component';
import { PrescriptionComponent }  from '../prescription/prescription.component';
import { BulletinComponent }      from '../bulletin/bulletin.component';

import { DocumentsService } from '../../services/documents.service';

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

  constructor(
  private router: Router,
  private route: ActivatedRoute,
  private documentsService: DocumentsService
) {}

ngOnInit() {
  // Try to get data from navigation state first (for backward compatibility)
  const nav = this.router.getCurrentNavigation()?.extras.state ?? history.state;
  
  if (nav.files && nav.files.length) {
    // Use the data from navigation state if available
    this.files = nav.files;
    this.selectedIndex = nav.selectedIndex ?? 0;
  } else {
    // Otherwise, get the courier ID from the route parameter
    this.route.paramMap.subscribe(params => {
      const courierId = params.get('courierId');
      
      if (!courierId) {
        this.router.navigate(['/']);
        return;
      }
      
      // Fetch courier data by ID
      this.documentsService.getCourierById(+courierId).subscribe({
        next: (courier) => {
          console.log('Fetched courier data:', courier);
          
          if (courier && courier.files && courier.files.length) {
            // Need to fetch OCR data for each file
            const ocrPromises = courier.files.map((file: { type: string; id: number; }) => {
              if (file.type === 'bulletin') {
                return this.documentsService.getBulletinById(file.id);
              } else if (file.type === 'ordonnance') {
                return this.documentsService.getOrdonnanceById(file.id);
              }
              return Promise.resolve(null);
            });
            
            // Wait for all OCR data to be fetched
            Promise.all(ocrPromises).then(ocrResults => {
              // Combine file metadata with OCR results
              this.files = courier.files.map((file: { type: string; }, index: number) => {
                const ocrData = ocrResults[index];
                return {
                  ...file,
                  ...ocrData, // Merge the OCR data
                  header: {
                    documentType: file.type === 'bulletin' ? 'bulletin_de_soin' : 
                                 file.type === 'ordonnance' ? 'prescription' : file.type
                  }
                };
              }).filter((f: null) => f !== null);
              
              if (this.files.length === 0) {
                this.router.navigate(['/']);
              }
            });
          } else {
            this.router.navigate(['/']);
          }
        },
        error: (error) => {
          console.error('Error fetching courier:', error);
          this.router.navigate(['/']);
        }
      });
    });
  }
}

  onAddMore() {
    this.addingMore = true;
  }

  onNewDocuments(newDocs: any[]) {
    // append to existing tabs
    this.files.push(...newDocs);

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
