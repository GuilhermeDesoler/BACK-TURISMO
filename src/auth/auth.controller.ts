import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { RegisterDto } from './dto/register.dto';
import { UserRole } from '../common/enums/user-role.enum';
import * as admin from 'firebase-admin';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private firebaseService: FirebaseService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto) {
    const db = this.firebaseService.getFirestore();

    // Verificar se usuario ja existe no Firestore
    const existing = await db.collection('users').doc(dto.uid).get();
    if (existing.exists) {
      throw new BadRequestException('Usuario ja cadastrado');
    }

    // Verificar se o UID existe no Firebase Auth
    try {
      await this.firebaseService.getAuth().getUser(dto.uid);
    } catch {
      throw new BadRequestException('UID invalido');
    }

    // Criar documento do usuario no Firestore
    await db.collection('users').doc(dto.uid).set({
      email: dto.email,
      name: dto.name,
      phone: dto.phone,
      cpf: '',
      role: UserRole.CLIENT,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    this.logger.log(`Usuario ${dto.email} registrado (${dto.uid})`);

    return { success: true, uid: dto.uid };
  }
}
