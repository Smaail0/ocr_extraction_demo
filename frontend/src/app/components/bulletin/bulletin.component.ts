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
  // prefer Angular Navigation state, fallback to native history.state
  const nav = this.router.getCurrentNavigation()?.extras.state;
  this.files = nav?.['files'] ?? (history.state.files ?? []);
  if (this.files.length) {
    this.selectTab(0);
  } else {
    // no data → redirect back
    this.router.navigate(['/']);
  }
  }

  /** Populate the formData and identifiant array from a parsed document */
  populateForm(data: any): void {
    this.formData = {
      prenom:            data.prenom,
      nom:               data.nom,
      adresse:           data.adresse,
      codePostal:        data.codePostal,
      prenomMalade:      data.prenomMalade,
      nomMalade:         data.nomMalade,
      assureSocial:      data.assureSocial,
      conjoint:          data.conjoint,
      enfant:            data.enfant,
      ascendant:         data.ascendant,
      dateNaissance:     data.dateNaissance,
      numTel:            data.numTel,
      refDossier:        data.refDossier,
      identifiantUnique: data.identifiantUnique,
      cnss:              data.cnss,
      cnrps:             data.cnrps,
      convbi:            data.convbi,
      patientType:       data.patientType
    };

    // annotate params to avoid implicit any
    const idStr = data.identifiantUnique || '';
    this.identifiant = Array.from(
      { length: 12 },
      (_: unknown, i: number) => idStr[i] || ''
    );
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

  /** Save changes and emit the verified data */
  saveChanges(): void {
    this.isEditMode = false;
    this.showStatusAlert = true;
    this.dataVerified.emit(this.getCompleteFormData());
    setTimeout(() => (this.showStatusAlert = false), 3000);
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
      identifiantUnique: this.identifiant.join('')
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
