import { UserRole } from '../enums/user-role.enum';

export interface User {
  uid: string;
  email: string;
  name: string;
  phone: string;
  cpf: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}
