import { Component } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-prescription',
  standalone: true,
  imports: [],
  templateUrl: './prescription.component.html',
  styleUrl: './prescription.component.css'
})
export class PrescriptionComponent {

  constructor(private router: Router) { }

  bulletinId = '123'; // Replace with dynamic value if needed
  prescriptionId = '456'; // Replace with dynamic value if needed


  goToBulletin() {
    this.router.navigate(['/bulletin', this.bulletinId]);
  }

  goToPrescription() {
    this.router.navigate(['/prescription', this.prescriptionId]);
  }
}
