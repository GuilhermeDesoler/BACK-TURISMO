import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { User } from '../common/interfaces/user.interface';
import { UserRole } from '../common/enums/user-role.enum';
import * as admin from 'firebase-admin';

interface FirestoreUserData {
  email: string;
  name: string;
  phone: string;
  cpf: string;
  role: string;
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private firebaseService: FirebaseService) {}

  async findOne(uid: string): Promise<User> {
    const db = this.firebaseService.getFirestore();
    const userDoc = await db.collection('users').doc(uid).get();

    if (!userDoc.exists) {
      throw new NotFoundException('Usuário não encontrado');
    }

    const data = userDoc.data() as FirestoreUserData;

    return {
      uid: userDoc.id,
      ...data,
      createdAt: data.createdAt.toDate(),
      updatedAt: data.updatedAt.toDate(),
    } as User;
  }

  async updateRole(uid: string, role: UserRole): Promise<void> {
    const validRoles = Object.values(UserRole);
    if (!validRoles.includes(role)) {
      throw new BadRequestException(
        `Role invalido. Valores aceitos: ${validRoles.join(', ')}`,
      );
    }

    const db = this.firebaseService.getFirestore();
    const ref = db.collection('users').doc(uid);
    const doc = await ref.get();

    if (!doc.exists) {
      throw new NotFoundException('Usuario nao encontrado');
    }

    await ref.update({
      role,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    this.logger.log(`Role do usuario ${uid} atualizado para ${role}`);
  }
}
