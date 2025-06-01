// src/app/models/bulletin.model.ts

export interface TableRow {
  [colKey: string]: string;
}

// The server’s full Bulletin record
export interface Bulletin {
  id: number;
  prenom: string;
  nom: string;
  adresse: string;
  codePostal: string;
  refDossier: string;
  identifiantUnique: string;
  cnss: boolean;
  cnrps: boolean;
  convbi: boolean;
  assureSocial: boolean;
  conjoint: boolean;
  enfant: boolean;
  ascendant: boolean;
  prenomMalade: string;
  nomMalade: string;
  dateNaissance: string;
  numTel: string; // ← exactly same as Pydantic
  // remove nomPrenomMalade, it does not exist in Pydantic
  consultationsDentaires: TableRow[];
  prothesesDentaires: TableRow[];
  consultationsVisites: TableRow[];
  actesMedicaux: TableRow[];
  actesParamed: TableRow[];
  biologie: TableRow[];
  hospitalisation: TableRow[];
  pharmacie: TableRow[];
  apci: boolean;
  mo: boolean;
  hosp: boolean;
  grossesse: boolean;
  codeApci: string;
  dateAccouchement: string | null;
  created_at: string;
  updated_at: string;
  is_verified: boolean;
}

// What you send on create/update (no id / timestamps / verification flag)
export type BulletinCreate = Omit<
  Bulletin,
  'id' | 'created_at' | 'updated_at' | 'is_verified'
>;
