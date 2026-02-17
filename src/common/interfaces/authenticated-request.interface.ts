import { Request } from 'express';
import { User } from './user.interface';

export interface AuthenticatedRequest extends Request {
  user: User;
}
