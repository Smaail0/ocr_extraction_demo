import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-stepper',
  standalone: true,
  imports: [ CommonModule ],
  templateUrl: './stepper.component.html',
  styleUrls: ['./stepper.component.css'],
})
export class StepperComponent {
  /** current step: 0 = Upload, 1 = Verify, 2 = Add Another Patient */
  @Input() step = 0;

  /** labels for each step */
  steps = ['Upload', 'Verify', 'Add Another Patient'];
}
