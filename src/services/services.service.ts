import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { Service } from '../common/interfaces/service.interface';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import * as admin from 'firebase-admin';

export interface MulterFile {
  originalname: string;
  buffer: Buffer;
  mimetype: string;
}

interface FirestoreServiceData {
  name: string;
  nameEn?: string;
  nameEs?: string;
  description: string;
  descriptionEn?: string;
  descriptionEs?: string;
  price: number;
  maxPeople: number;
  duration: number;
  isActive: boolean;
  requiresDocuments: string[];
  imageUrls: string[];
  createdAt: admin.firestore.Timestamp;
}

@Injectable()
export class ServicesService {
  constructor(private firebaseService: FirebaseService) {}

  /**
   * Criar serviço
   */
  async create(dto: CreateServiceDto): Promise<Service> {
    const db = this.firebaseService.getFirestore();

    const serviceData: Record<string, unknown> = {
      name: dto.name,
      description: dto.description,
      price: dto.price,
      maxPeople: dto.maxPeople,
      duration: dto.duration,
      isActive: dto.isActive ?? true,
      requiresDocuments: dto.requiresDocuments ?? [],
      imageUrls: dto.imageUrls ?? [],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (dto.nameEn) serviceData['nameEn'] = dto.nameEn;
    if (dto.nameEs) serviceData['nameEs'] = dto.nameEs;
    if (dto.descriptionEn) serviceData['descriptionEn'] = dto.descriptionEn;
    if (dto.descriptionEs) serviceData['descriptionEs'] = dto.descriptionEs;

    const serviceRef = await db.collection('services').add(serviceData);
    const serviceDoc = await serviceRef.get();
    const data = serviceDoc.data() as FirestoreServiceData;

    return {
      id: serviceRef.id,
      ...data,
      createdAt: data.createdAt?.toDate() ?? new Date(),
    } as Service;
  }

  /**
   * Listar todos os serviços
   */
  async findAll(activeOnly: boolean = false): Promise<Service[]> {
    const db = this.firebaseService.getFirestore();

    let query: admin.firestore.Query = db
      .collection('services')
      .orderBy('createdAt', 'desc');

    if (activeOnly) {
      query = query.where('isActive', '==', true);
    }

    const snapshot = await query.get();

    return snapshot.docs.map((doc) => {
      const data = doc.data() as FirestoreServiceData;
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate() ?? new Date(),
      } as Service;
    });
  }

  /**
   * Buscar serviço por ID
   */
  async findOne(id: string): Promise<Service> {
    const db = this.firebaseService.getFirestore();
    const serviceDoc = await db.collection('services').doc(id).get();

    if (!serviceDoc.exists) {
      throw new NotFoundException('Serviço não encontrado');
    }

    const data = serviceDoc.data() as FirestoreServiceData;

    return {
      id: serviceDoc.id,
      ...data,
      createdAt: data.createdAt?.toDate() ?? new Date(),
    } as Service;
  }

  /**
   * Atualizar serviço
   */
  async update(id: string, dto: UpdateServiceDto): Promise<Service> {
    const db = this.firebaseService.getFirestore();
    const serviceRef = db.collection('services').doc(id);

    const serviceDoc = await serviceRef.get();
    if (!serviceDoc.exists) {
      throw new NotFoundException('Serviço não encontrado');
    }

    const updateData: Record<string, unknown> = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (dto.name !== undefined) updateData['name'] = dto.name;
    if (dto.nameEn !== undefined) updateData['nameEn'] = dto.nameEn;
    if (dto.nameEs !== undefined) updateData['nameEs'] = dto.nameEs;
    if (dto.description !== undefined) updateData['description'] = dto.description;
    if (dto.descriptionEn !== undefined) updateData['descriptionEn'] = dto.descriptionEn;
    if (dto.descriptionEs !== undefined) updateData['descriptionEs'] = dto.descriptionEs;
    if (dto.price !== undefined) updateData['price'] = dto.price;
    if (dto.maxPeople !== undefined) updateData['maxPeople'] = dto.maxPeople;
    if (dto.duration !== undefined) updateData['duration'] = dto.duration;
    if (dto.isActive !== undefined) updateData['isActive'] = dto.isActive;
    if (dto.requiresDocuments !== undefined)
      updateData['requiresDocuments'] = dto.requiresDocuments;
    if (dto.imageUrls !== undefined) updateData['imageUrls'] = dto.imageUrls;

    await serviceRef.update(updateData);

    return this.findOne(id);
  }

  /**
   * Deletar serviço (soft delete - apenas desativa)
   */
  async remove(id: string): Promise<void> {
    const db = this.firebaseService.getFirestore();
    const serviceRef = db.collection('services').doc(id);

    const serviceDoc = await serviceRef.get();
    if (!serviceDoc.exists) {
      throw new NotFoundException('Serviço não encontrado');
    }

    await serviceRef.update({
      isActive: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  /**
   * Deletar permanentemente
   */
  async hardDelete(id: string): Promise<void> {
    const db = this.firebaseService.getFirestore();
    const serviceRef = db.collection('services').doc(id);

    const serviceDoc = await serviceRef.get();
    if (!serviceDoc.exists) {
      throw new NotFoundException('Serviço não encontrado');
    }

    // Verificar se há pedidos usando este serviço
    const ordersSnapshot = await db
      .collection('orders')
      .where('items', 'array-contains', { serviceId: id })
      .limit(1)
      .get();

    if (!ordersSnapshot.empty) {
      throw new BadRequestException(
        'Não é possível deletar serviço com pedidos associados',
      );
    }

    await serviceRef.delete();
  }

  /**
   * Upload de imagem para Firebase Storage
   */
  async uploadImage(serviceId: string, file: MulterFile): Promise<string> {
    const storage = this.firebaseService.getStorage();
    const bucket = storage.bucket();

    // Gerar nome único
    const timestamp = Date.now();
    const fileName = `services/${serviceId}/${timestamp}-${file.originalname}`;

    const fileUpload = bucket.file(fileName);

    await fileUpload.save(file.buffer, {
      metadata: {
        contentType: file.mimetype,
      },
      public: true,
    });

    // Obter URL pública
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

    // Adicionar URL ao serviço
    const db = this.firebaseService.getFirestore();
    const serviceRef = db.collection('services').doc(serviceId);

    await serviceRef.update({
      imageUrls: admin.firestore.FieldValue.arrayUnion(publicUrl),
    });

    return publicUrl;
  }

  /**
   * Remover imagem
   */
  async removeImage(serviceId: string, imageUrl: string): Promise<void> {
    const db = this.firebaseService.getFirestore();
    const serviceRef = db.collection('services').doc(serviceId);

    await serviceRef.update({
      imageUrls: admin.firestore.FieldValue.arrayRemove(imageUrl),
    });
  }
}
