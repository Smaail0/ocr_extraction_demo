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
    // page-1 / insured
    id:                null as number|null,
    prenom:            '',
    nom:               '',
    adresse:           '',
    codePostal:        '',
    refDossier:        '',
    identifiantUnique: '',
    
    cnss:              false,
    cnrps:             false,
    convbi:            false,
    
    // page-1 / patient
    assureSocial:      false,
    conjoint:          false,
    enfant:            false,
    ascendant:         false,
    prenomMalade:      '',
    nomMalade:         '',
    dateNaissance:     '',
    numTel:            '',
    nomPrenomMalade:   '',
    
    // 12-box ID splitter
    identifiant:       Array(12).fill(''),
    
    // page-1 left tables
    consultations:      [] as TableRow[],
    protheses:          [] as TableRow[],
    
    // page-2 checks & fields
    apci:                false,
    mo:                  false,
    hosp:                false,
    grossesse:           false,
    codeApci:            '',
    dateAccouchement:    '' as string| null,
    
    // page-2 tables
    visites:            [] as TableRow[],
    actesMedicaux:      [] as TableRow[],
    actesParam:         [] as TableRow[],
    biologie:           [] as TableRow[],
    hospitals:          [] as TableRow[],
    pharmacie:          [] as TableRow[],

    patientType:         'self',
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

  private populateForm(parsed: any): void {
    // 1) clear any previous banner
    this.showStatusAlert = false;
  
    // 2) alias
    const src = parsed || {};
  
    // 3) rebuild formData (everything except the identifiant 12-box)
    this.formData = {
      ...this.formData,
  
      // simple fields
      prenom:            src.prenom             || '',
      nom:               src.nom                || '',
      adresse:           src.adresse            || '',
      codePostal:        src.codePostal         || '',
      refDossier:        src.header?.dossierId  || src.refDossier      || '',
      identifiantUnique: src.identifiantUnique  || '',
      cnss:              !!src.cnss,
      cnrps:             !!src.cnrps,
      convbi:            !!src.convbi,
      assureSocial:      !!src.assureSocial,
      conjoint:          !!src.conjoint,
      enfant:            !!src.enfant,
      ascendant:         !!src.ascendant,
      prenomMalade:      src.prenomMalade       || '',
      nomMalade:         src.nomMalade          || '',
      dateNaissance:     src.dateNaissance      || '',
      nomPrenomMalade:   src.nomPrenomMalade    || '',
  
      // ── remap each table into exactly the keys your template expects ──
      consultations: this.mapRows(src.consultationsDentaires    || [], [
        'date','dent','codeActe','cotation','honoraires','codePs','signature'
      ]).slice(1),
      protheses:     this.mapRows(src.prothesesDentaires        || [], [
        'date','dents','codeActe','cotation','honoraires','codePs','signature'
      ]).slice(1),
      visites:       this.mapRows(src.consultationsVisites      || [], [
        'date','designation','honoraires','codePs','signature'
      ]).slice(1),
      actesMedicaux: this.mapRows(src.actesMedicaux             || [], [
        'date','designation','honoraires','codePs','signature'
      ]).slice(1),
      actesParam:    this.mapRows(src.actesParamed              || [], [
        'date','designation','honoraires','codePs','signature'
      ]).slice(1),
      biologie:      this.mapRows(src.biologie                  || [], [
        'date','montant','codePs','signature'
      ]).slice(1),
      hospitals:     this.mapRows(src.hospitalisation           || [], [
        'date','codeHosp','forfait','codeClinique','signature'
      ]).slice(1),
      pharmacie:     this.mapRows(src.pharmacie                 || [], [
        'date','montant','codePs','signature'
      ]).slice(1),
  
      // page-2 checks & extras
      apci:             !!src.apci,
      mo:               !!src.mo,
      hosp:             !!src.hospitalisationCheck,
      grossesse:        !!src.suiviGrossesseCheck,
      codeApci:         src.codeApci           || '',
      dateAccouchement: src.datePrevu          || null,
  
      // preserve dropdown / radio selection
      patientType:      this.formData.patientType
    };
  
    // 4) split out the 12-box identifiant
    this.identifiant = Array.from(
      { length: 12 },
      (_, i) => (this.formData.identifiantUnique || '')[i] || ''
    );
  
    // 5) auto‐hide the “saved” banner
    setTimeout(() => this.showStatusAlert = false, 3_000);
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
    // 1) leave edit mode & show the “changes saved” banner
    this.isEditMode      = false;
    this.showStatusAlert = true;
  
    // 2) build a payload matching your Pydantic model exactly
    const payload = {
      // ○ simple scalar fields
      prenom:            this.formData.prenom,
      nom:               this.formData.nom,
      adresse:           this.formData.adresse,
      codePostal:        this.formData.codePostal,
      refDossier:        this.formData.refDossier,
      identifiantUnique: this.identifiant.join(''),
  
      cnss:              this.formData.cnss,
      cnrps:             this.formData.cnrps,
      convbi:            this.formData.convbi,
  
      // ○ the eight JSON table columns
      consultationsDentaires: this.formData.consultations,
      prothesesDentaires:     this.formData.protheses,
      consultationsVisites:   this.formData.visites,
      actesMedicaux:          this.formData.actesMedicaux,
      actesParamed:           this.formData.actesParam,
      biologie:               this.formData.biologie,
      hospitalisation:        this.formData.hospitals,
      pharmacie:              this.formData.pharmacie,
  
      // ○ healthcare-professional section
      apci:                   this.formData.apci,
      mo:                     this.formData.mo,
      hosp:                   this.formData.hosp,
      grossesse:              this.formData.grossesse,
      codeApci:               this.formData.codeApci,
      dateAccouchement:       this.formData.dateAccouchement,
  
      // ○ patient type & patient info
      assureSocial:           this.formData.assureSocial,
      conjoint:               this.formData.conjoint,
      enfant:                 this.formData.enfant,
      ascendant:              this.formData.ascendant,
  
      prenomMalade:           this.formData.prenomMalade,
      nomMalade:              this.formData.nomMalade,
      dateNaissance:          this.formData.dateNaissance,
      numTel:                 this.formData.numTel,
      nomPrenomMalade:        this.formData.nomPrenomMalade
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
