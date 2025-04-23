import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { UploadDocComponent } from './components/upload-doc/upload-doc.component';
import { BulletinComponent }   from './components/bulletin/bulletin.component';

export const routes: Routes = [
  { path: '', component: UploadDocComponent, pathMatch: 'full' },
  { path: 'bulletin', component: BulletinComponent },
  { path: 'bulletin/:id', component: BulletinComponent },
  { path: '**', redirectTo: '' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule {}
