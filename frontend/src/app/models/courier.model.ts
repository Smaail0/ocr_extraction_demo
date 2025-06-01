export interface UploadedFileInfo {
  id: number;
  filename: string;
  original_name: string;
  path: string;
  type: 'prescription' | 'bulletin';
  prescription_id?: number;
  bulletin_id?: number;
  uploaded_at: string;
  parsed_data?: Record<string, any>;
  is_verified?: boolean;
  size_in_bytes: number;  
}

export interface Courier {
  id: number;
  mat_fiscale: string;
  nom_complet_adherent: string;
  nom_complet_beneficiaire: string;
  created_at: string;
  files: UploadedFileInfo[];
}
