import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { DocumentsService } from './documents.service';
import { Prescription } from '../models/prescription.model';

describe('DocumentsService', () => {
  let service: DocumentsService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:8000';

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ HttpClientTestingModule ],
      providers: [ DocumentsService ]
    });
    service = TestBed.inject(DocumentsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should POST to /bulletin/parse for processBulletin()', () => {
    const fakeFile = new File(['dummy'], 'test.pdf', { type: 'application/pdf' });
    service.processBulletin(fakeFile).subscribe();

    const req = httpMock.expectOne(`${apiUrl}/bulletin/parse`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.has('file')).toBeTrue();
    req.flush({});  // simulate empty response
  });

  it('should POST to /prescription/parse for processPrescription()', () => {
    const fakeFile = new File(['dummy'], 'ord.pdf', { type: 'application/pdf' });
    service.processPrescription(fakeFile).subscribe((res: Prescription) => {
      // you can assert on res here once you flush
    });

    const req = httpMock.expectOne(`${apiUrl}/prescription/parse`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.has('file')).toBeTrue();
    req.flush({  // simulate a minimal Prescription
      pharmacyName: '',
      pharmacyAddress: '',
      pharmacyContact: '',
      pharmacyFiscalId: '',
      beneficiaryId: '',
      patientIdentity: '',
      prescriberCode: '',
      prescriptionDate: '',
      regimen: '',
      dispensationDate: '',
      executor: '',
      pharmacistCnamRef: '',
      items: [],
      total: '',
      totalInWords: '',
      footerName: '',
      footerAddress: '',
      footerContact: '',
      footerFiscalId: ''
    });
  });
});
