// loading.component.ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-loading',
  template: `
    <div class="loading‐container">
      <div class="spinner"></div>
      <p>Chargement en cours…</p>
    </div>
  `,
  styles: [`
    .loading‐container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      background: #f5f5f5;
    }

    .spinner {
      width: 64px;
      height: 64px;
      border: 8px solid rgba(0,0,0,0.1);
      border-top-color: #0066cc;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-bottom: 1rem;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    p {
      font-size: 1.2rem;
      color: #333;
      margin: 0;
    }
  `]
})
export class LoadingComponent { }
