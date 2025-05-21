// src/app/components/admin-panel/admin-panel.component.ts
import { Component, OnInit } from '@angular/core';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators
} from '@angular/forms';
import { CommonModule } from '@angular/common';

import { MatTableModule }    from '@angular/material/table';
import { MatFormFieldModule }from '@angular/material/form-field';
import { MatInputModule }    from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule }   from '@angular/material/button';
import { MatIconModule }     from '@angular/material/icon';
import { MatTooltipModule }  from '@angular/material/tooltip';
import {
  MatDialogModule,
  MatDialog
} from '@angular/material/dialog';

import { UserService}       from '../../services/user.service';
import { ConfirmDialogComponent }  from '../confirm-dialog/confirm-dialog.component';
import { MatCardModule } from '@angular/material/card';
import { AuthService } from '../../services/auth.service';
import { RouterModule } from '@angular/router';
import { User, UserUpdate } from '../../models/user.model';
import { EditUserDialogComponent } from '../edit-user-dialog/edit-user-dialog.component';


@Component({
  selector: 'app-admin-panel',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterModule,
    MatCardModule,
    MatTableModule,
    MatFormFieldModule,
    MatInputModule,
    MatCheckboxModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatDialogModule

  ],
  templateUrl: './admin-panel.component.html',
  styleUrls: [
    '../dashboard/dashboard.component.css',
    './admin-panel.component.css'
  ]
})
export class AdminPanelComponent implements OnInit {
  form!: FormGroup;
  users: User[] = [];
  displayedColumns = ['user','role','actions'];
  editing = false;
  currentUser?: User;
  showPassword = false;

  constructor(
    private fb: FormBuilder,
    private userService: UserService,
    private dialog: MatDialog,
    public auth: AuthService
  ) {}

  ngOnInit(): void {
    this.form = this.fb.group({
      username:    ['', [Validators.required]],
      email:       ['', [Validators.required, Validators.email]],
      password:    ['', [Validators.required]],
      is_active:   [true],
      is_superuser:[false]
    });
    this.loadUsers();
  }

  toggleShowPassword(): void {
    this.showPassword = !this.showPassword;
  }

  loadUsers(): void {
    this.userService.list().subscribe(users => (this.users = users));
    this.startCreate();
  }

async openEditDialog(user: User) {
  const { EditUserDialogComponent } = await import(
    '../edit-user-dialog/edit-user-dialog.component'
  );
  const ref = this.dialog.open(EditUserDialogComponent, {
    data: user,
    width: '500px'
  });

  ref.afterClosed().subscribe((updated: User & { password?: string }) => {
    if (updated) {
      const payload: Partial<UserUpdate> = {
        username:     updated.username,
        email:        updated.email,
        is_active:    updated.is_active,
        is_superuser: updated.is_superuser
      };
      if (updated.password) {
        payload.password = updated.password;
      }

      this.userService.patch(updated.id, payload).subscribe(() => this.loadUsers());
    }
  });
}

  startCreate(): void {
    this.editing = false;
    this.currentUser = undefined;
    this.form.reset({
      username: '',
      email: '',
      password: '',
      is_active: true,
      is_superuser: false
    });
    this.form.get('password')?.setValidators([Validators.required]);
    this.form.get('password')?.updateValueAndValidity();
  }

  startEdit(user: User): void {
    this.editing = true;
    this.currentUser = user;
    this.form.patchValue({
      username: user.username,
      email: user.email,
      password: '',
      is_active: user.is_active,
      is_superuser: user.is_superuser
    });
    this.form.get('password')?.clearValidators();
    this.form.get('password')?.updateValueAndValidity();
  }

save(): void {
  if (this.form.invalid) { /*…*/ }
  const { username, email, password, is_active, is_superuser } = this.form.value;

  if (this.editing && this.currentUser) {
    // always include username
    const payload: any = { username, email, is_active, is_superuser };
    if (password) payload.password = password;
    this.userService.patch(this.currentUser.id, payload)
        .subscribe(() => this.reload());
  } else {
    // include username on create too!
    this.userService.create({ username, email, password, is_superuser })
        .subscribe(() => this.reload());
  }
}

async remove(user: User): Promise<void> {
  const { ConfirmDialogComponent } = await import(
    '../confirm-dialog/confirm-dialog.component'
  );

  const ref = this.dialog.open(ConfirmDialogComponent, {
    data: { message: `Delete ${user.email}?` },
    width: '400px'
  });

  ref.afterClosed().subscribe(yes => {
    if (yes) {
      this.userService.delete(user.id).subscribe(() => this.reload());
    }
  });
}

  private reload(): void {
    this.loadUsers();
  }
}
