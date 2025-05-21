import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { UploadDocComponent }      from './components/upload-doc/upload-doc.component';
import { ExtractedContainerComponent } from './components/extracted-tabs/extracted-container.component';
import { LoginComponent } from './components/login/login.component';
import { AdminPanelComponent } from './components/admin-panel/admin-panel.component';
import { AuthGuard } from './guards/auth.guard';
import { DashboardComponent } from './components/dashboard/dashboard.component';

export const routes: Routes = [
  { path: 'dashboard', component: DashboardComponent },
  {
    path: 'login',
    component: LoginComponent,
    data: { hideSidebar: true }
  },
    {
    path: 'extracted',
    component: ExtractedContainerComponent,
    data: { hideSidebar: true }
  },
  {
    path: 'admin',
    component: AdminPanelComponent,
    canActivate: [AuthGuard]
  },
  { 
    path: 'login',
    component: LoginComponent,
    data: { hideSidebar: true }
  },
  { path: '',
    component: UploadDocComponent,
    data: { hideSidebar: true }
  },
  { path: 'extracted', component: ExtractedContainerComponent },
  { path: '**',      redirectTo: '' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule {}
