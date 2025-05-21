import { Component, OnInit } from '@angular/core';
import { CommonModule }      from '@angular/common';
import { RouterModule, Router }      from '@angular/router';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule
} from '@angular/forms';

import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterModule
  ],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent implements OnInit {
  loginForm!: FormGroup;
  showPassword = false;

  loading = false;
  errorMsg: string | null = null;

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.loginForm = this.fb.group({
      email:    ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required]]
    });
  }

  toggleShowPassword(): void {
    this.showPassword = !this.showPassword;
  }

onSubmit(): void {
    if (this.loginForm.invalid) return;

    this.loading = true;
    this.errorMsg = null;

    const { email, password } = this.loginForm.value;

    this.auth.login(email, password).subscribe({
      next: tokenRes => {
        // Store JWT however you prefer:
        localStorage.setItem('access_token', tokenRes.access_token);
        // Then navigate to your dashboard or home page:
        this.router.navigate(['/admin']);
      },
      error: err => {
        this.loading = false;
        this.errorMsg = err.status === 401
          ? 'Email or password incorrect'
          : 'Login failed, please try again';
      }
    });
  }
}
