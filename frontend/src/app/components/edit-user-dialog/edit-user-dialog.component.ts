import { Component, Inject } from '@angular/core';
import {
  ReactiveFormsModule, FormsModule, FormBuilder, FormGroup, Validators
} from '@angular/forms';
import { CommonModule }                           from '@angular/common';
import {
  MatDialogModule, MatDialogRef, MAT_DIALOG_DATA
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule }     from '@angular/material/input';
import { MatCheckboxModule }  from '@angular/material/checkbox';
import { User } from '../../models/user.model';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'edit-user-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatCheckboxModule,
    MatButtonModule,
  ],
  templateUrl: './edit-user-dialog.component.html',
  styleUrls: [
    './edit-user-dialog.component.css',
    '../admin-panel/admin-panel.component.css'
  ]
})
export class EditUserDialogComponent {
  form: FormGroup;
  showPassword = false;

  constructor(
    fb: FormBuilder,
    private dialogRef: MatDialogRef<EditUserDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: User
  ) {
    // initialize with data.username, data.email, etc.
    this.form = fb.group({
      username:    [data.username,    Validators.required],
      email:       [data.email,       [Validators.required, Validators.email]],
      password:    [''],
      is_active:   [data.is_active],
      is_superuser:[data.is_superuser]
    });
  }

  toggleShowPassword(): void {
    this.showPassword = !this.showPassword;
  }

  save() {
    if (this.form.valid) {
      // close with the updated user object
      this.dialogRef.close({ ...this.data, ...this.form.value });
    }
  }

  cancel() {
    this.dialogRef.close();
  }
}
