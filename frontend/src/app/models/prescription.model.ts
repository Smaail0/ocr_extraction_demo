// src/app/models/prescription.model.ts

export interface DocumentHeader {
  /** 'prescription' or 'bulletin_de_soin' */
  documentType: string;
}

export interface PrescriptionItem {
  codePCT: string;
  produit: string;
  forme: string;
  qte: string;
  puv: string;
  montantRes: string;
  montantPercu: string;
  nio: string;
  prLot: string;
}

export interface Prescription {
  header: DocumentHeader;

  /** optional name of the uploaded file */
  fileName?: string;

  pharmacyName: string;
  pharmacyAddress?: string;
  pharmacyContact?: string;
  pharmacyFiscalId?: string;

  beneficiaryId?: string;
  patientIdentity: string;
  prescriberCode?: string;
  prescriptionDate?: string;
  regimen?: string;
  dispensationDate?: string;

  executor?: string;
  pharmacistCnamRef?: string;

  items: PrescriptionItem[];

  total?: string;
  totalInWords?: string;

  footerName?: string;
  footerAddress?: string;
  footerContact?: string;
  footerFiscalId?: string;

  mtPercu?: string;
  mtRes?: string;

  signatureCropFile?: string | null;
}

// This is what you send to the POST /prescription endpoint
export interface PrescriptionCreate {
  pharmacyName: string;
  pharmacyAddress?: string;
  pharmacyContact?: string;
  pharmacyFiscalId?: string;
  beneficiaryId?: string;
  patientIdentity: string;
  prescriberCode?: string;
  prescriptionDate?: string;
  regimen?: string;
  dispensationDate?: string;
  executor?: string;
  pharmacistCnamRef?: string;
  items: PrescriptionItem[];
  total?: string;
  totalInWords?: string; 
}