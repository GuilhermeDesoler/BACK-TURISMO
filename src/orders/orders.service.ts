import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { OrderStatus } from '../common/enums/order-status.enum';
import { Order, OrderItem } from '../common/interfaces/order.interface';
import { CalculateOrderDto } from './dto/calculate-order.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import * as admin from 'firebase-admin';

interface FirestoreServiceData {
  name: string;
  price: number;
  isActive: boolean;
}

interface FirestoreOrderData {
  userId: string;
  items: Array<{
    serviceId: string;
    serviceName: string;
    quantity: number;
    price: number;
    scheduledDate?: string;
    teamId?: string;
    timeSlot?: string;
  }>;
  totalAmount: number;
  discountApplied: number;
  depositAmount: number;
  remainingAmount: number;
  status: OrderStatus;
  peopleCount: number;
  // Legacy top-level fields (optional for new orders)
  scheduledDate?: admin.firestore.Timestamp;
  teamId?: string;
  timeSlot?: string;
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
}

@Injectable()
export class OrdersService {
  constructor(private firebaseService: FirebaseService) {}

  /**
   * Calcular total do pedido com desconto
   */
  async calculateTotal(dto: CalculateOrderDto) {
    const { items, peopleCount } = dto;
    const db = this.firebaseService.getFirestore();

    let subtotal = 0;
    const serviceDetails: Array<{
      serviceId: string;
      serviceName: string;
      quantity: number;
      price: number;
    }> = [];

    // Buscar dados dos serviços
    for (const item of items) {
      const serviceDoc = await db
        .collection('services')
        .doc(item.serviceId)
        .get();

      if (!serviceDoc.exists) {
        throw new NotFoundException(`Serviço ${item.serviceId} não encontrado`);
      }

      const service = serviceDoc.data() as FirestoreServiceData;

      if (!service.isActive) {
        throw new BadRequestException(
          `Serviço ${service.name} não está disponível`,
        );
      }

      const itemTotal = service.price * item.quantity;
      subtotal += itemTotal;

      serviceDetails.push({
        serviceId: item.serviceId,
        serviceName: service.name,
        quantity: item.quantity,
        price: service.price,
      });
    }

    // Calcular desconto (10% para 3+ serviços)
    const totalServices = items.reduce((sum, item) => sum + item.quantity, 0);
    const discountRate = totalServices >= 3 ? 0.1 : 0;
    const discountAmount = subtotal * discountRate;

    // Totais
    const totalAmount = subtotal - discountAmount;
    const depositAmount = totalAmount * 0.3; // 30%
    const remainingAmount = totalAmount * 0.7; // 70%

    return {
      items: serviceDetails,
      subtotal,
      discountRate,
      discountAmount,
      totalAmount,
      depositAmount,
      remainingAmount,
      peopleCount,
    };
  }

  /**
   * Criar pedido com scheduling por item
   */
  async create(userId: string, dto: CreateOrderDto) {
    // Validar todas as datas dos itens
    for (const item of dto.items) {
      const scheduledDate = new Date(item.scheduledDate);
      if (isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
        throw new BadRequestException(
          'Todas as datas agendadas devem ser datas futuras válidas',
        );
      }
    }

    const db = this.firebaseService.getFirestore();

    // Calcular valores
    const calculated = await this.calculateTotal({
      items: dto.items.map((i) => ({
        serviceId: i.serviceId,
        quantity: i.quantity,
      })),
      peopleCount: dto.peopleCount,
    });

    // Enriquecer items com scheduling info
    const itemsWithScheduling: OrderItem[] = calculated.items.map(
      (calcItem, index) => ({
        ...calcItem,
        scheduledDate: dto.items[index].scheduledDate,
        teamId: dto.items[index].teamId,
        timeSlot: dto.items[index].timeSlot,
      }),
    );

    // Criar pedido sem campos top-level de scheduling
    const orderData = {
      userId,
      items: itemsWithScheduling,
      totalAmount: calculated.totalAmount,
      discountApplied: calculated.discountAmount,
      depositAmount: calculated.depositAmount,
      remainingAmount: calculated.remainingAmount,
      status: OrderStatus.PENDING,
      peopleCount: dto.peopleCount,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const orderRef = await db.collection('orders').add(orderData);

    return {
      orderId: orderRef.id,
      ...calculated,
      items: itemsWithScheduling,
    };
  }

  /**
   * Buscar pedido por ID
   */
  async findOne(orderId: string): Promise<Order> {
    const db = this.firebaseService.getFirestore();
    const orderDoc = await db.collection('orders').doc(orderId).get();

    if (!orderDoc.exists) {
      throw new NotFoundException('Pedido não encontrado');
    }

    const data = orderDoc.data() as FirestoreOrderData;
    return this.mapOrderDoc(orderDoc.id, data);
  }

  /**
   * Buscar pedidos do usuário
   */
  async findByUser(userId: string): Promise<Order[]> {
    const db = this.firebaseService.getFirestore();
    const snapshot = await db
      .collection('orders')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data() as FirestoreOrderData;
      return this.mapOrderDoc(doc.id, data);
    });
  }

  /**
   * Buscar todos os pedidos (admin)
   */
  async findAll(): Promise<Order[]> {
    const db = this.firebaseService.getFirestore();
    const snapshot = await db
      .collection('orders')
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data() as FirestoreOrderData;
      return this.mapOrderDoc(doc.id, data);
    });
  }

  /**
   * Atualizar status do pedido
   */
  async updateStatus(orderId: string, status: OrderStatus): Promise<void> {
    const db = this.firebaseService.getFirestore();

    await db.collection('orders').doc(orderId).update({
      status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  /**
   * Adicionar pagamento ao pedido
   */
  async addPayment(
    orderId: string,
    paymentData: {
      amount: number;
      type: 'DEPOSIT' | 'FINAL';
      status: string;
      paymentMethod: string;
      transactionId?: string;
      paymentLink?: string;
    },
  ): Promise<void> {
    const db = this.firebaseService.getFirestore();

    await db
      .collection('orders')
      .doc(orderId)
      .collection('payments')
      .add({
        ...paymentData,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
  }

  /**
   * Adicionar notificação ao pedido
   */
  async addNotification(
    orderId: string,
    notificationData: {
      type: string;
      message: string;
      status: string;
    },
  ): Promise<void> {
    const db = this.firebaseService.getFirestore();

    await db
      .collection('orders')
      .doc(orderId)
      .collection('notifications')
      .add({
        ...notificationData,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });
  }

  /**
   * Mapper: Firestore doc → Order (backwards compatible)
   */
  private mapOrderDoc(id: string, data: FirestoreOrderData): Order {
    return {
      id,
      userId: data.userId,
      items: (data.items || []).map((item) => ({
        serviceId: item.serviceId,
        serviceName: item.serviceName,
        quantity: item.quantity,
        price: item.price,
        // Per-item scheduling (new orders) or fallback to top-level (legacy)
        scheduledDate:
          item.scheduledDate ||
          data.scheduledDate?.toDate().toISOString() ||
          '',
        teamId: item.teamId || data.teamId || '',
        timeSlot: item.timeSlot || data.timeSlot || '',
      })),
      totalAmount: data.totalAmount,
      discountApplied: data.discountApplied,
      depositAmount: data.depositAmount,
      remainingAmount: data.remainingAmount,
      status: data.status,
      peopleCount: data.peopleCount,
      scheduledDate: data.scheduledDate?.toDate(),
      teamId: data.teamId,
      timeSlot: data.timeSlot,
      createdAt: data.createdAt.toDate(),
      updatedAt: data.updatedAt.toDate(),
    };
  }
}
