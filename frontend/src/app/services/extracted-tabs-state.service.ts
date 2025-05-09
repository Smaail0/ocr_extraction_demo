// src/app/services/extracted-tabs-state.service.ts
import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ExtractedTabsState {
  /** true = panel expanded */
  isOpen = true;
}
