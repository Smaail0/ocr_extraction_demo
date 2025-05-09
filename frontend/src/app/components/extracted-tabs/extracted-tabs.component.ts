import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ExtractedTabsState } from '../../services/extracted-tabs-state.service';

@Component({
  selector: 'app-extracted-tabs',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './extracted-tabs.component.html',
  styleUrls: ['./extracted-tabs.component.css'],
})
export class ExtractedTabsComponent {
  @Input() files: any[] = [];
  @Input() selectedIndex = 0;
  @Output() selectedIndexChange = new EventEmitter<number>();
  @Output() plusClick = new EventEmitter<void>();

  constructor(public state: ExtractedTabsState) {}

  selectTab(i: number) {
    this.selectedIndex = i;
    this.selectedIndexChange.emit(i);
  }

  addNew() {
    this.plusClick.emit();
  }
}
