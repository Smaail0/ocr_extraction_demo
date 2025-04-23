import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CnamCardComponent } from './cnam-card.component';

describe('CnamCardComponent', () => {
  let component: CnamCardComponent;
  let fixture: ComponentFixture<CnamCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CnamCardComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CnamCardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
