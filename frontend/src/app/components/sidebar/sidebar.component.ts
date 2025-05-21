import { Component }            from '@angular/core';
import { CommonModule }         from '@angular/common';
import { RouterModule }         from '@angular/router';
import { AuthService }          from '../../services/auth.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './sidebar.component.html',
  styleUrls: [
    './sidebar.component.css',
    '../dashboard/dashboard.component.css',
  ]
})
export class SidebarComponent {
  constructor(public auth: AuthService) {}
}
