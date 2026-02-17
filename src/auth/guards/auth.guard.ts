import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { FirebaseService } from '../../firebase/firebase.service';
import { AuthenticatedRequest } from '../../common/interfaces/authenticated-request.interface';
import { User } from '../../common/interfaces/user.interface';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private firebaseService: FirebaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Token não fornecido');
    }

    try {
      const decodedToken = await this.firebaseService
        .getAuth()
        .verifyIdToken(token);

      // Buscar dados do usuário no Firestore
      const userDoc = await this.firebaseService
        .getFirestore()
        .collection('users')
        .doc(decodedToken.uid)
        .get();

      if (!userDoc.exists) {
        throw new UnauthorizedException('Usuário não encontrado');
      }

      request.user = {
        uid: decodedToken.uid,
        email: decodedToken.email,
        ...userDoc.data(),
      } as User;

      return true;
    } catch {
      throw new UnauthorizedException('Token inválido');
    }
  }

  private extractToken(request: AuthenticatedRequest): string | null {
    const authHeader = request.headers.authorization;
    if (!authHeader) return null;

    const [bearer, token] = authHeader.split(' ');
    return bearer === 'Bearer' ? token : null;
  }
}
