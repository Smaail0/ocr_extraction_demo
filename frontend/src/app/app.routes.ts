import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { UploadDocComponent } from './components/upload-doc/upload-doc.component';
import { BulletinComponent }   from './components/bulletin/bulletin.component';

export const routes: Routes = [
  // Upload screen
  { path: '',                  component: UploadDocComponent, pathMatch: 'full' },

  // Single-document view
  { path: 'extracted/:id',     component: BulletinComponent },

  // Multi-document tabs view
  { path: 'extracted/tabs',    component: BulletinComponent },

  // Legacy “bulletin” alias → go to the tabs view
  { path: 'bulletin',          redirectTo: 'extracted/tabs', pathMatch: 'full' },

  // Catch-all
  { path: '**',                redirectTo: '' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule {}
