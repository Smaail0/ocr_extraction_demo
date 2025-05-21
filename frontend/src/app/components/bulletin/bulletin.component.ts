import { Component, Input, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule }  from '@angular/common';
import { FormsModule }   from '@angular/forms';
import { RouterModule }  from '@angular/router';
import { DocumentsService } from '../../services/documents.service';
type TableRow = { [colKey: string]: string };

@Component({
  selector: 'app-bulletin',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './bulletin.component.html',
  styleUrls: ['./bulletin.component.css'],
})
export class BulletinComponent implements OnInit {
  @Input() data!: any; // this will hold the parsed JSON data

    
  private mapRows(rows: any[], keys: string[]): TableRow[] {
    return (rows || []).map(r => {
      const obj: TableRow = {};
      for (const k of keys) {
        obj[k] = (r[k] ?? '').toString();
      }
      return obj;
    });
  }
  
  formData = {
    id:                null as number | null,
    prenom:            '',
    nom:               '',
    adresse:           '',
    codePostal:        '',
    refDossier:        '',
    identifiantUnique: '',
    cnss:              false,
    cnrps:             false,
    convbi:            false,
    assureSocial:      false,
    conjoint:          false,
    enfant:            false,
    ascendant:         false,
    prenomMalade:      '',
    nomMalade:         '',
    dateNaissance:     '',
    numTel:            '',
    nomPrenomMalade:   '',
    identifiant:       Array(12).fill(''),
    consultations:     [] as TableRow[],
    protheses:         [] as TableRow[],
    visites:           [] as TableRow[],
    actesMedicaux:     [] as TableRow[],
    actesParam:        [] as TableRow[],
    biologie:          [] as TableRow[],
    hospitals:         [] as TableRow[],
    pharmacie:         [] as TableRow[],
    apci:              false,
    mo:                false,
    hosp:              false,
    grossesse:         false,
    codeApci:          '',
    dateAccouchement:  '' as string | null,
    patientType:       'self',
  };

  identifiant: string[] = Array(12).fill('');

  isEditMode = false;
  showStatusAlert = false;

  constructor(private documentsService: DocumentsService) {}

  ngOnInit(): void {
  }
  
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['data'] && this.data) {
      this.populateForm(this.data);
    }
  }

  private populateForm(src: any): void {
    this.showStatusAlert = false;
    const s = src || {};

    // copy all scalar fields
    this.formData = {
      ...this.formData,
      id:                s.id ?? null,
      prenom:            s.prenom            || '',
      nom:               s.nom               || '',
      adresse:           s.adresse           || '',
      codePostal:        s.codePostal        || '',
      refDossier:        s.header?.dossierId || s.refDossier    || '',
      identifiantUnique: s.identifiantUnique || '',
      cnss:              !!s.cnss,
      cnrps:             !!s.cnrps,
      convbi:            !!s.convbi,
      assureSocial:      !!s.assureSocial,
      conjoint:          !!s.conjoint,
      enfant:            !!s.enfant,
      ascendant:         !!s.ascendant,
      prenomMalade:      s.prenomMalade      || '',
      nomMalade:         s.nomMalade         || '',
      dateNaissance:     s.dateNaissance     || '',
      nomPrenomMalade:   s.nomPrenomMalade   || '',

      // remap tables (skip header row with .slice(1))
      consultations: this.mapRows(s.consultationsDentaires || [], [
        'date','dent','codeActe','cotation','honoraires','codePs','signature'
      ]).slice(1),
      protheses: this.mapRows(s.prothesesDentaires || [], [
        'date','dents','codeActe','cotation','honoraires','codePs','signature'
      ]).slice(1),
      visites: this.mapRows(s.consultationsVisites || [], [
        'date','designation','honoraires','codePs','signature'
      ]).slice(1),
      actesMedicaux: this.mapRows(s.actesMedicaux || [], [
        'date','designation','honoraires','codePs','signature'
      ]).slice(1),
      actesParam: this.mapRows(s.actesParamed || [], [
        'date','designation','honoraires','codePs','signature'
      ]).slice(1),
      biologie: this.mapRows(s.biologie || [], [
        'date','montant','codePs','signature'
      ]).slice(1),
      hospitals: this.mapRows(s.hospitalisation || [], [
        'date','codeHosp','forfait','codeClinique','signature'
      ]).slice(1),
      pharmacie: this.mapRows(s.pharmacie || [], [
        'date','montant','codePs','signature'
      ]).slice(1),

      apci:            !!s.apci,
      mo:              !!s.mo,
      hosp:            !!s.hospitalisationCheck,
      grossesse:       !!s.suiviGrossesseCheck,
      codeApci:        s.codeApci          || '',
      dateAccouchement: s.datePrevu        || null,

      patientType:     this.formData.patientType
    };

    // split the 12-box ID
    this.formData.identifiant = Array.from({ length: 12 }, (_, i) =>
      (this.formData.identifiantUnique || '')[i] || ''
    );
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
    this.isEditMode = false;
    this.showStatusAlert = true;

    // build payload, including `id` so Pydantic knows when to PUT vs POST
    const payload = {
      id:                 this.formData.id,
      prenom:             this.formData.prenom,
      nom:                this.formData.nom,
      adresse:            this.formData.adresse,
      codePostal:         this.formData.codePostal,
      refDossier:         this.formData.refDossier,
      identifiantUnique:  this.formData.identifiant.join(''),
      cnss:               this.formData.cnss,
      cnrps:              this.formData.cnrps,
      convbi:             this.formData.convbi,
      consultationsDentaires: this.formData.consultations,
      prothesesDentaires:     this.formData.protheses,
      consultationsVisites:   this.formData.visites,
      actesMedicaux:          this.formData.actesMedicaux,
      actesParamed:           this.formData.actesParam,
      biologie:               this.formData.biologie,
      hospitalisation:        this.formData.hospitals,
      pharmacie:              this.formData.pharmacie,
      apci:               this.formData.apci,
      mo:                 this.formData.mo,
      hosp:               this.formData.hosp,
      grossesse:          this.formData.grossesse,
      codeApci:           this.formData.codeApci,
      dateAccouchement:   this.formData.dateAccouchement,
      assureSocial:       this.formData.assureSocial,
      conjoint:           this.formData.conjoint,
      enfant:             this.formData.enfant,
      ascendant:          this.formData.ascendant,
      prenomMalade:       this.formData.prenomMalade,
      nomMalade:          this.formData.nomMalade,
      dateNaissance:      this.formData.dateNaissance,
      numTel:             this.formData.numTel,
      nomPrenomMalade:    this.formData.nomPrenomMalade
    };
  
    // 3) send it up
    this.documentsService.saveBulletinData(payload).subscribe({
      next: saved => {
        // if we got back an `id`, store it so future saves do PUT instead of POST
        this.formData.id = saved.id;
        console.log('✅ Saved to DB:', saved);
      },
      error: err => {
        console.error('❌ Error saving bulletin:', err);
        alert('Oops! Could not save your corrections. Please try again.');
      }
    });
  
    // 4) auto-hide the banner
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
