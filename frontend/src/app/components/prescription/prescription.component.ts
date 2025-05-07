import { Component, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { DocumentsService } from '../../services/documents.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-prescription',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './prescription.component.html',
  styleUrl: './prescription.component.css'
})
export class PrescriptionComponent implements OnInit {
  // Main data object
  ordonnance: any = {
    nom_pharmacie: '',
    adresse_pharmacie: '',
    telephone_fax: '',
    matricule_fiscale: '',
    id_beneficiaire: '',
    nom_malade: '',
    code_prescripteur: '',
    date_prescription: '',
    regime: '',
    date_dispensation: '',
    code_executeur: '',
    reference_cnam: '',
    code_pct: '',
    produit: '',
    forme: '',
    quantite: null,
    prix_unitaire: null,
    montant_percu: null,
    nio: '',
    pr_lot: '',
    montant_total: null,
    montant_en_lettres: ''
  };

  // Properties for form handling
  isEditMode = false;
  showStatusAlert = false;
  isEditing: boolean = false;
  ordonnanceId: number | null = null;
  uploadedFile: File | null = null;
  errorMessage: string = '';
  successMessage: string = '';
  processingFile: boolean = false;
  
  // Properties for document extraction view
  files: any[] = [];
  selectedIndex = 0;


  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private documentsService: DocumentsService
  ) { }

  ngOnInit(): void {
    // Check if we're editing an existing ordonnance (could be determined by route parameter)
    const url = this.router.url;
    const id = url.split('/').pop();
    if (id && !isNaN(Number(id))) {
      this.ordonnanceId = Number(id);
      this.loadOrdonnance(this.ordonnanceId);
      this.isEditing = false;
    }

    // Get files from navigation state if available
    const navState = this.router.getCurrentNavigation()?.extras.state || history.state;
    this.files = navState?.files || [];
    if (this.files.length > 0) {
      this.selectTab(0);
    }
  }

  loadOrdonnance(id: number): void {
    this.documentsService.getOrdonnanceById(id).subscribe({
      next: (data) => {
        this.ordonnance = data;
      },
      error: (error) => {
        this.errorMessage = 'Impossible de charger l\'ordonnance';
        console.error('Error loading ordonnance:', error);
      }
    });
  }


  toggleEditMode(): void {
    if (this.isEditMode) {
      // Save changes when exiting edit mode
      this.showStatusAlert = true;
      this.isEditMode = false;
      // Auto-hide status message after 3 seconds
      setTimeout(() => this.showStatusAlert = false, 3000);
    } else {
      // Enter edit mode
      this.isEditMode = true;
      this.showStatusAlert = true;
    }
  }

  /**
   * Calculate total based on quantity and price
   */
  calculateTotal(): void {
    if (this.ordonnance.quantite && this.ordonnance.prix_unitaire) {
      this.ordonnance.montant_percu = this.ordonnance.quantite * this.ordonnance.prix_unitaire;
      this.ordonnance.montant_total = this.ordonnance.montant_percu;
      
      // Optional: Convert the amount to words
      this.convertAmountToWords();
    }
  }

  /**
   * Convert the numerical amount to words (French)
   * This is a simplistic implementation; could be expanded for more accuracy
   */
  convertAmountToWords(): void {
    if (this.ordonnance.montant_total) {
      const amount = this.ordonnance.montant_total;
      this.ordonnance.montant_en_lettres = `${amount} Dinars Tunisiens`;
      // In a real implementation, you'd use a proper number-to-words library
      // or implement a comprehensive algorithm
    }
  }

  /**
   * Save the prescription data
   */
  

  saveOrdonnance(): void {
    this.documentsService.saveOrdonnanceData(this.ordonnance).subscribe({
      next: (savedData) => {
        this.successMessage = 'Ordonnance enregistrée avec succès';
        this.ordonnanceId = savedData.id; // Assuming the API returns the ID
        this.isEditing = true;
      },
      error: (error) => {
        this.errorMessage = 'Erreur lors de l\'enregistrement de l\'ordonnance';
        console.error('Error saving ordonnance:', error);
      }
    });
  }


  /**
   * Process the selected file with OCR
   */
  processFile(): void {
    if (!this.uploadedFile) return;
  
    this.processingFile = true;
    this.errorMessage = '';
    this.successMessage = '';
  
    this.documentsService.processOrdonnance(this.uploadedFile).subscribe({
      next: (result) => {
        this.processingFile = false;
        this.successMessage = 'Ordonnance traitée avec succès';
        
        console.log('Raw ordonnance data from API:', result);
        
        if (result) {
          // Clear all previous values to avoid mixing old and new data
          Object.keys(this.ordonnance).forEach(key => {
            if (typeof this.ordonnance[key] === 'number') {
              this.ordonnance[key] = null;
            } else {
              this.ordonnance[key] = '';
            }
          });
          
          // Explicitly map each field from the result to our model
          // This ensures we handle both string and numeric fields correctly
          if (result.nom_pharmacie) this.ordonnance.nom_pharmacie = result.nom_pharmacie;
          if (result.adresse_pharmacie) this.ordonnance.adresse_pharmacie = result.adresse_pharmacie;
          if (result.telephone_fax) this.ordonnance.telephone_fax = result.telephone_fax;
          if (result.matricule_fiscale) this.ordonnance.matricule_fiscale = result.matricule_fiscale;
          
          if (result.id_beneficiaire) this.ordonnance.id_beneficiaire = result.id_beneficiaire;
          if (result.nom_malade) this.ordonnance.nom_malade = result.nom_malade;
          if (result.code_prescripteur) this.ordonnance.code_prescripteur = result.code_prescripteur;
          if (result.date_prescription) this.ordonnance.date_prescription = result.date_prescription;
          if (result.regime) this.ordonnance.regime = result.regime;
          if (result.date_dispensation) this.ordonnance.date_dispensation = result.date_dispensation;
          if (result.code_executeur) this.ordonnance.code_executeur = result.code_executeur;
          if (result.reference_cnam) this.ordonnance.reference_cnam = result.reference_cnam;
          
          if (result.code_pct) this.ordonnance.code_pct = result.code_pct;
          if (result.produit) this.ordonnance.produit = result.produit;
          if (result.forme) this.ordonnance.forme = result.forme;
          
          // Handle numeric fields
          if (result.quantite) this.ordonnance.quantite = parseInt(result.quantite);
          
          // For price fields that may have comma as decimal separator
          if (result.prix_unitaire) {
            const price = typeof result.prix_unitaire === 'string' 
              ? parseFloat(result.prix_unitaire.replace(',', '.'))
              : result.prix_unitaire;
            this.ordonnance.prix_unitaire = price;
          }
          
          if (result.montant_percu) {
            const amount = typeof result.montant_percu === 'string'
              ? parseFloat(result.montant_percu.replace(',', '.'))
              : result.montant_percu;
            this.ordonnance.montant_percu = amount;
          }
          
          if (result.nio) this.ordonnance.nio = result.nio;
          if (result.pr_lot) this.ordonnance.pr_lot = result.pr_lot;
          
          if (result.montant_total) this.ordonnance.montant_total = result.montant_total;
          if (result.montant_en_lettres) this.ordonnance.montant_en_lettres = result.montant_en_lettres;
          
          // Calculate total if we have quantity and price but no total
          if (this.ordonnance.quantite && this.ordonnance.prix_unitaire && !this.ordonnance.montant_total) {
            this.calculateTotal();
          }
          
          // Log the final mapped object
          console.log('Final mapped ordonnance object:', {...this.ordonnance});
        }
      },
      error: (error) => {
        this.processingFile = false;
        this.errorMessage = 'Erreur lors du traitement de l\'ordonnance';
        console.error('Error processing ordonnance:', error);
      }
    });
  }

  /**
   * Upload the ordonnance
   */
  uploadOrdonnance(): void {
    if (!this.uploadedFile) {
      this.errorMessage = 'Veuillez sélectionner un fichier';
      return;
    }

    this.errorMessage = '';
    this.successMessage = '';

    this.documentsService.uploadOrdonnances([this.uploadedFile]).subscribe({
      next: (result) => {
        this.successMessage = 'Ordonnance téléchargée avec succès';
      },
      error: (error) => {
        this.errorMessage = 'Erreur lors du téléchargement de l\'ordonnance';
        console.error('Error uploading ordonnance:', error);
      }
    });
  }

  /**
   * Switch to a different document tab
   */
  selectTab(index: number): void {
    this.selectedIndex = index;
    
    // If files contain relevant data, map directly to ordonnance object
    if (this.files[index]) {
      const docData = this.files[index];
      
      // Check if this is an ordonnance object with the expected structure
      if (docData && typeof docData === 'object') {
        console.log('Mapping file data to ordonnance:', docData);
        
        // Direct mapping (if docData has flat structure like your example JSON)
        Object.keys(docData).forEach(key => {
          if (this.ordonnance.hasOwnProperty(key) && docData[key] !== null && docData[key] !== undefined) {
            this.ordonnance[key] = docData[key];
          }
        });
        
        // Or handle nested structure if that's what's coming from your backend
        // This is the fallback for your current structure

        
        if (docData.patient) {
          this.ordonnance.nom_malade = docData.patient.lastName || '';
          if (docData.patient.firstName) {
            this.ordonnance.nom_malade = `${docData.patient.firstName} ${this.ordonnance.nom_malade}`.trim();
          }
          this.ordonnance.id_beneficiaire = docData.patient.id || '';
        }
        
        // If there is pharmacy info, populate pharmacy fields
        if (docData.pharmacy) {
          this.ordonnance.nom_pharmacie = docData.pharmacy.name || '';
          this.ordonnance.adresse_pharmacie = docData.pharmacy.address || '';
          this.ordonnance.telephone_fax = docData.pharmacy.phone || '';
          this.ordonnance.matricule_fiscale = docData.pharmacy.fiscalId || '';
        }
        
        // If there is prescription info, populate those fields
        if (docData.prescription) {
          this.ordonnance.date_prescription = docData.prescription.date || '';
          this.ordonnance.code_prescripteur = docData.prescription.doctorId || '';
        }
      }
    }
  }
  logChange(field: string, value: any): void {
    console.log(`Field ${field} changed to:`, value);
    this.ordonnance[field] = value;
  }
}