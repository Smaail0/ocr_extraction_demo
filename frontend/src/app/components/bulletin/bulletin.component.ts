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

    this.showStatusAlert = false;
  

    const src = parsed || {};
  
    this.formData = {
      ...this.formData,

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
  
      apci:             !!src.apci,
      mo:               !!src.mo,
      hosp:             !!src.hospitalisationCheck,
      grossesse:        !!src.suiviGrossesseCheck,
      codeApci:         src.codeApci           || '',
      dateAccouchement: src.datePrevu          || null,

      patientType:      this.formData.patientType
    };
 
    this.identifiant = Array.from(
      { length: 12 },
      (_, i) => (this.formData.identifiantUnique || '')[i] || ''
    );
  

    setTimeout(() => this.showStatusAlert = false, 3000);
  }  


  setPatientType(type: 'assureSocial' | 'conjoint' | 'enfant' | 'ascendant'): void {
    if (!this.isEditMode) return;
    this.formData.assureSocial = (type === 'assureSocial');
    this.formData.conjoint     = (type === 'conjoint');
    this.formData.enfant       = (type === 'enfant');
    this.formData.ascendant    = (type === 'ascendant');
  }


  toggleEditMode(): void {
    if (this.isEditMode) {
      this.saveChanges();
    } else {
      this.isEditMode = true;
      this.showStatusAlert = true;
    }
  }

  saveChanges(): void {

    this.isEditMode      = false;
    this.showStatusAlert = true;
  
    const payload = {

      prenom:            this.formData.prenom,
      nom:               this.formData.nom,
      adresse:           this.formData.adresse,
      codePostal:        this.formData.codePostal,
      refDossier:        this.formData.refDossier,
      identifiantUnique: this.identifiant.join(''),
  
      cnss:              this.formData.cnss,
      cnrps:             this.formData.cnrps,
      convbi:            this.formData.convbi,

      patientIdentity: `${this.formData.prenom} ${this.formData.nom}`.trim(),

      consultationsDentaires: this.formData.consultations,
      prothesesDentaires:     this.formData.protheses,
      consultationsVisites:   this.formData.visites,
      actesMedicaux:          this.formData.actesMedicaux,
      actesParamed:           this.formData.actesParam,
      biologie:               this.formData.biologie,
      hospitalisation:        this.formData.hospitals,
      pharmacie:              this.formData.pharmacie,

      apci:                   this.formData.apci,
      mo:                     this.formData.mo,
      hosp:                   this.formData.hosp,
      grossesse:              this.formData.grossesse,
      codeApci:               this.formData.codeApci,
      dateAccouchement:       this.formData.dateAccouchement,

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
  
    this.documentsService.saveBulletinData(payload).subscribe({
      next: saved => {

        this.formData.id = saved.id;
        console.log('✅ Saved to DB:', saved);
      },
      error: err => {
        console.error('❌ Error saving bulletin:', err);
        alert('Oops! Could not save your corrections. Please try again.');
      }
    });
  
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
      patientIdentity: `${this.formData.prenom} ${this.formData.nom}`.trim(),
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
