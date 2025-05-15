import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UploadComponent } from '../upload/upload.component'; // Adjust the path as needed

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, UploadComponent],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})

export class DashboardComponent {
  showUploadModal = false;
  
  openUploadModal(): void {
    this.showUploadModal = true;
  }
  
  closeUploadModal(uploadSuccess: boolean = false): void {
    this.showUploadModal = false;
    // Optionally process uploadSuccess if needed
  }
}