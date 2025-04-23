import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UploadDocComponent } from './upload-doc.component';

describe('UploadDocComponent', () => {
  let component: UploadDocComponent;
  let fixture: ComponentFixture<UploadDocComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UploadDocComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(UploadDocComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
