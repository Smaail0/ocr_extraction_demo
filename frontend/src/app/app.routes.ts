import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { UploadDocComponent } from './components/upload-doc/upload-doc.component';
<<<<<<< HEAD
import { BulletinComponent }   from './components/bulletin/bulletin.component';
=======
import { BulletinComponent } from './components/bulletin/bulletin.component';
>>>>>>> 73afa47c0a3ec4e1407e4ada3f2097ebd299e40e
import { PrescriptionComponent } from './components/prescription/prescription.component';

export const routes: Routes = [
  // Upload screen
  { path: '', component: UploadDocComponent, pathMatch: 'full' },

  // Single-document view
  { path: 'extracted/:id', component: BulletinComponent },

  { path: 'ordonnance', component: PrescriptionComponent },

  // Multi-document tabs view
  { path: 'extracted/tabs', component: BulletinComponent },

  // Ordonnance
  { path: 'ordonnance',    component: PrescriptionComponent },

  // Legacy “bulletin” alias → go to the tabs view
  { path: 'bulletin', redirectTo: 'extracted/tabs', pathMatch: 'full' },

  // Catch-all
  { path: '**', redirectTo: '' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
