import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { UploadDocComponent } from './components/upload-doc/upload-doc.component';
import { ExtractedContainerComponent } from './components/extracted-tabs/extracted-container.component';
import { LoginComponent } from './components/login/login.component';
import { AdminPanelComponent } from './components/admin-panel/admin-panel.component';
import { AuthGuard } from './guards/auth.guard';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { CourierDetailComponent } from './components/courier-detail/courier-detail.component';
import { BulletinComponent } from './components/bulletin/bulletin.component';
import { PrescriptionComponent } from './components/prescription/prescription.component';
import { AdminGuard } from './guards/admin.guard';

export const routes: Routes = [
  { path: '', redirectTo: '/dashboard', pathMatch: 'full' },
  { path: 'login', component: LoginComponent, data: { hideSidebar: true } },
  {
    path: 'dashboard',
    component: DashboardComponent,
    canActivate: [AuthGuard],
  },
  { path: 'admin', component: AdminPanelComponent, canActivate: [AdminGuard] },
  {
    path: 'extracted',
    component: ExtractedContainerComponent,
    data: { hideSidebar: true },
  },

  // ← Make sure this comes *before* the wildcard
  {
    path: 'courriers/:id/extracted',
    component: CourierDetailComponent,
    data: { hideSidebar: true },
    canActivate: [AuthGuard],
  },

  {
    path: 'bulletins/:fileId',
    component: BulletinComponent,
    data: { hideSidebar: true },
    canActivate: [AuthGuard],
  },
  {
    path: 'prescriptions/:fileId',
    component: PrescriptionComponent,
    data: { hideSidebar: true },
    canActivate: [AuthGuard],
  },

  // finally, your catch-all
  { path: '**', redirectTo: '' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule {}
