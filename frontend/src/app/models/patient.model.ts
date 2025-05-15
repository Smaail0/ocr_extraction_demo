export interface Patient {
  id: number;
  bulletinFile?: File;
  prescriptionFile?: File;
  error?: string;
}
