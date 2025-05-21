export interface User {
  id: number;
  username: string;
  email: string;
  is_active: boolean;
  is_superuser: boolean;
  created_at: string;   
  updated_at: string;   
}

export interface UserCreate {
  username: string;
  email: string;
  password: string;
  is_superuser?: boolean;
  is_active?: boolean;
}
export interface UserUpdate {
  username?: string;
  email?: string;
  password?: string;
  is_active?: boolean;
  is_superuser?: boolean;
}
