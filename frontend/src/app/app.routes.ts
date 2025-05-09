import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { UploadDocComponent }      from './components/upload-doc/upload-doc.component';
import { ExtractedContainerComponent } from './components/extracted-tabs/extracted-container.component';

export const routes: Routes = [
  { path: '',        component: UploadDocComponent },
  { path: 'extracted', component: ExtractedContainerComponent },
  { path: '**',      redirectTo: '' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
