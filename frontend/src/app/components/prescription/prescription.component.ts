import { Component, Input, OnInit, SimpleChanges}   from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';      // ← import ActivatedRoute
import { CommonModule }        from '@angular/common';
import { FormsModule }         from '@angular/forms';
import { Prescription, PrescriptionCreate }        from '../../models/prescription.model';
import writtenNumber from 'written-number'
import { environment } from '../../../environments/environment';
import { ExtractedTabsComponent }  from '../extracted-tabs/extracted-tabs.component';
import { HttpErrorResponse } from '@angular/common/http';
import { HttpClientModule } from '@angular/common/http';
import { SignatureResult, DocumentsService } from '../../services/documents.service';


writtenNumber.defaults.lang = 'fr';

@Component({
  selector: 'app-prescription',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule,
    HttpClientModule
  ],
  templateUrl: './prescription.component.html',
  styleUrls: ['./prescription.component.css']
})
export class PrescriptionComponent implements OnInit {
  @Input() prescription!: Prescription;

  signatureLoading = false;
  signatureResult: SignatureResult | null = null;
  isEditMode = false;
  showStatusAlert = false;
  isEditing: boolean = false;
  ordonnanceId: number | null = null;
  uploadedFile: File | null = null;
  errorMessage: string = '';
  successMessage: string = '';
  processingFile: boolean = false;

  get signatureUrl(): string | null {
    return this.prescription.signatureCropFile
      ? `${environment.apiBaseUrl}/${this.prescription.signatureCropFile}`
      : null;
  }

  files: any[] = [];
  selectedIndex = 0;
  formData = {
    refDossier: ''
  };
  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private documentsService: DocumentsService
  ) {}

  private calculateTotalInWords() {
    const raw = this.prescription.total ?? '';
    const m = raw.match(/(\d{1,3}(?:[ \.,]\d{3})*(?:[.,]\d+)?)/);
    if (!m) { this.prescription.totalInWords = ''; return; }
    const [intPart, fracPart = ''] = m[1]
      .replace(/\s/g,'').replace(',','.').split('.');
    const dinars   = parseInt(intPart, 10) || 0;
    const millimes = parseInt((fracPart+'000').slice(0,3),10) || 0;
    const parts: string[] = [];
    if (dinars)   parts.push(`${writtenNumber(dinars)} dinar${dinars>1?'s':''}`);
    if (millimes) parts.push(`${writtenNumber(millimes)} millime${millimes>1?'s':''}`);
    this.prescription.totalInWords = parts.length ? parts.join(' ') : 'zéro dinar';
  }

  private normalizeDates() {
    if (!this.prescription) return;
  
    const toIso = (d?: string): string|undefined => {
      // 1) If it's falsy or not a string, leave it alone
      if (typeof d !== 'string' || !d.includes('/')) {
        return d;
      }
  
      const parts = d.split('/');
      // 2) If it doesn't split to exactly 3 parts, leave it alone
      if (parts.length !== 3) {
        return d;
      }
  
      let [dd, mm, yy] = parts.map(p => p.trim());
      // 3) Two-digit year → assume 20xx
      if (yy.length === 2) yy = '20' + yy;
  
      // 4) Now you can safely padStart
      const day   = dd.padStart(2, '0');
      const month = mm.padStart(2, '0');
  
      return `${yy}-${month}-${day}`;
    };
  
    this.prescription.prescriptionDate  = toIso(this.prescription.prescriptionDate);
    this.prescription.dispensationDate = toIso(this.prescription.dispensationDate);
  }
  
  analyseSignature() {
    console.log('» analyseSignature clicked, id =', this.prescription.id);
    if (!this.prescription.id) return;
    this.signatureLoading = true;
    this.documentsService.verifySignature(this.prescription.id).subscribe({
      next: (res) => {
        this.signatureResult  = res;
        this.signatureLoading = false;
      },
      error: () => {
        this.signatureLoading = false;
      }
    });
  }

  private parseFrenchNumber(s?: string): number {
    if (!s) return 0;
    // remove regular spaces + NBSP + narrow NBSP, then convert comma→dot
    const cleaned = s
      .replace(/[\u00A0\u202F\s]+/g, '')
      .replace(',', '.');
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  }

  calculateTotals(): void {
  const parseFrenchNumber = (s?: string): number => {
    if (!s) return 0;
    const cleaned = s.replace(/[\u00A0\u202F\s]+/g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  };

  const totalNum = parseFrenchNumber(this.prescription.total);
  const sumPercu = this.prescription.items
    .map(i => parseFrenchNumber(i.montantPercu))
    .reduce((a, b) => a + b, 0);
  const remaining = Math.max(0, totalNum - sumPercu);

  const formatNumber = (n: number): string => {
    // if there's a fractional part, show exactly 3 decimals
    const hasFraction = Math.abs(n % 1) > 1e-9;
    const opts: Intl.NumberFormatOptions = hasFraction
      ? { minimumFractionDigits: 3, maximumFractionDigits: 3 }
      : { minimumFractionDigits: 0, maximumFractionDigits: 0 };
    // use en-US to get comma as thousands separator and dot as decimal point
    return n.toLocaleString('en-US', opts);
  };

  this.prescription.mtPercu = formatNumber(sumPercu);
  this.prescription.mtRes   = formatNumber(remaining);

  this.calculateTotalInWords();
}

  ngOnInit() {
    // Only reset flags here, do NOT read router state any more:
    this.isEditMode      = false;
    this.showStatusAlert = false;
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['prescription'] && this.prescription) {
      // whenever the container feeds us a new prescription…
      this.normalizeDates();
      this.calculateTotals();
    }
  }
  
  toggleEditMode(): void {
    if (this.isEditMode) {
      // 1) leave edit mode
      this.isEditMode = false;
  
      // 2) push the changes to the back-end
      this.saveToDb();
  
      // 3) show a “saved” alert
      this.showStatusAlert = true;
      setTimeout(() => this.showStatusAlert = false, 3000);
    } else {
      // entering edit mode
      this.isEditMode      = true;
      this.showStatusAlert = false;
    }
  }

saveToDb(): void {
  // 1) build a proper PrescriptionCreate payload from your UI model
  const payload: PrescriptionCreate = {
    pharmacyName:      this.prescription.pharmacyName,
    pharmacyAddress:   this.prescription.pharmacyAddress,
    pharmacyContact:   this.prescription.pharmacyContact,
    pharmacyFiscalId:  this.prescription.pharmacyFiscalId,
    beneficiaryId:     this.prescription.beneficiaryId,
    patientIdentity:   this.prescription.patientIdentity,
    prescriberCode:    this.prescription.prescriberCode,
    prescriptionDate:  this.prescription.prescriptionDate,
    regimen:           this.prescription.regimen,
    dispensationDate:  this.prescription.dispensationDate,
    executor:          this.prescription.executor,
    pharmacistCnamRef: this.prescription.pharmacistCnamRef,
    items:             this.prescription.items,
    total:             this.prescription.total,
    totalInWords:      this.prescription.totalInWords,

    signatureCropFile:  this.prescription.signatureCropFile ?? undefined,
    nom_prenom_docteur: this.prescription.nom_prenom_docteur ?? undefined,
  };

  console.log('📤 Saving prescription:', payload);

  // 2) call the service
  this.documentsService.savePrescription(payload).subscribe({
    next: presc => {
      console.log('✅ Saved prescription:', presc);
      this.successMessage = 'Ordonnance enregistrée en base !';

      this.prescription.id = presc.id;
      Object.assign(this.prescription, presc);
    },
    error: err => {
      console.error('❌ Saving prescription failed', err);
      this.errorMessage = 'Échec de l’enregistrement.';
    }
  });
}

  goBack() {
    this.router.navigate(['/']);
  }

  goToBulletin() {
    this.router.navigate(['/extracted/tabs']);
  }

  goToPrescription() {
    this.router.navigate(['/prescription']);
  }
}
