import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Output, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DocumentsService } from '../../services/documents.service';
import { Router, ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-bulletin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './bulletin.component.html',
  styleUrls: ['./bulletin.component.css'],
})
export class BulletinComponent implements OnInit {
  @Output() dataVerified = new EventEmitter<any>();

  files: any[] = [];
  selectedIndex = 0;

  formData = {
    id: null as number | null,
    prenom: '',
    nom: '',
    adresse: '',
    codePostal: '',
    prenomMalade: '',
    nomMalade: '',
    assureSocial: false,
    conjoint: false,
    enfant: false,
    ascendant: false,
    dateNaissance: '',
    numTel: '',
    refDossier: '',
    identifiantUnique: '',
    cnss: false,
    cnrps: false,
    convbi: false,
    patientType: 'self'
  };

  identifiant: string[] = Array(12).fill('');

  isEditMode = false;
  showStatusAlert = false;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private documentsService: DocumentsService
  ) {}

  ngOnInit() {
    // Try navigation state first, fallback to history.state
    const navState = this.router.getCurrentNavigation()?.extras.state
                   || history.state;
    this.files = navState?.files || [];
    if (!this.files.length) {
      // nothing to show → send them back
      this.router.navigate(['/']);
      return;
    }
    this.selectTab(0);
  }

  /** Pull nested OCR result into your flat formData */
  populateForm(parsed: any): void {
    // 1) Set everything to your defaults based on the payload…
    this.formData = {
      id:                this.formData.id,
      prenom:            parsed.insured.firstName    || '',
      nom:               parsed.insured.lastName     || '',
      adresse:           parsed.insured.address      || '',
      codePostal:        parsed.insured.postalCode   || '',
      refDossier:        parsed.header.dossierId     || '',
      identifiantUnique: parsed.insured.uniqueId     || '',
      cnss:              parsed.insured.cnssChecked  || false,
      cnrps:             parsed.insured.cnrpsChecked || false,
      convbi:            parsed.insured.conventionChecked || false,
      prenomMalade:      parsed.patient.firstName    || '',
      nomMalade:         parsed.patient.lastName     || '',
      dateNaissance:     parsed.patient.birthDate    || '',
      numTel:            '',
      // initialize all four to false, we’ll flip exactly one on next step:
      assureSocial:      false,
      conjoint:          false,
      enfant:            parsed.patient.isChild     || false,
      ascendant:         false,
      patientType:       parsed.patient.isChild ? 'enfant' : 'self'
    };
  
    // 2) Now override exactly one of the four “who’s the patient” flags:
    switch (this.formData.patientType) {
      case 'self':
        this.formData.assureSocial = true;
        break;
      case 'conjoint':
        this.formData.conjoint = true;
        break;
      case 'enfant':
        this.formData.enfant = true;
        break;
      case 'ascendant':
        this.formData.ascendant = true;
        break;
    }
  
    // 3) Split the 12-digit ID into the little boxes
    const s = this.formData.identifiantUnique;
    this.identifiant = Array.from({ length: 12 }, (_, i) => s[i] || '');
  }
  /** Switch to a different parsed document tab */
  selectTab(index: number): void {
    this.selectedIndex = index;
    this.populateForm(this.files[index]);
  }

  /** Only one patient type allowed, and only in edit mode */
  setPatientType(type: 'assureSocial' | 'conjoint' | 'enfant' | 'ascendant'): void {
    if (!this.isEditMode) return;
    this.formData.assureSocial = (type === 'assureSocial');
    this.formData.conjoint     = (type === 'conjoint');
    this.formData.enfant       = (type === 'enfant');
    this.formData.ascendant    = (type === 'ascendant');
  }

  /** Toggle between view and edit modes */
  toggleEditMode(): void {
    if (this.isEditMode) {
      this.saveChanges();
    } else {
      this.isEditMode = true;
      this.showStatusAlert = true;
    }
  }

  saveChanges(): void {
    // 1) leave edit mode & show the alert
    this.isEditMode = false;
    this.showStatusAlert = true;
  
    // 2) build the corrected payload
    const payload = this.getCompleteFormData();
  
    // 3) send it to the server
    this.documentsService.saveBulletinData(payload).subscribe({
      next: saved => {
        // if this was a new POST, the backend will return its new `id`
        // stash it into formData so future calls become PUTs:
        this.formData.id = saved.id;
  
        // optional: replace your “Changes saved” alert with something fancier
        console.log('Saved to DB:', saved);
      },
      error: err => {
        console.error('Error saving:', err);
        alert('Oops! Could not save your corrections. Please try again.');
      }
    });
  
    // 4) auto-hide the status message in 3 s
    setTimeout(() => this.showStatusAlert = false, 3000);
  }

  onSubmit(): void {
    const payload = this.getCompleteFormData();
    this.documentsService.saveBulletinData(payload).subscribe({
      next: () => alert('Document submitted successfully!'),
      error: err => {
        console.error('Submit error', err);
        alert('Failed to submit document.');
      }
    });
  }

  private getCompleteFormData(): any {
    return {
      ...this.formData,
      identifiantUnique: this.identifiant.join(''),
      id: this.formData.id,
    };
  }

  onCheckboxChange(checkboxName: string): void {
    if (checkboxName === 'cnss'   && this.formData.cnss) {
      this.formData.cnrps = false;
      this.formData.convbi = false;
    }
    if (checkboxName === 'cnrps'  && this.formData.cnrps) {
      this.formData.cnss  = false;
      this.formData.convbi = false;
    }
    if (checkboxName === 'convbi' && this.formData.convbi) {
      this.formData.cnss  = false;
      this.formData.cnrps = false;
    }
  }
}
