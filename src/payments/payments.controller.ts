import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ForbiddenException,
  Headers,
  Logger,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { createHmac } from 'crypto';
import { Environment } from '../common/config/environment';
import { PaymentsService } from './payments.service';
import { OrdersService } from '../orders/orders.service';
import { SchedulesService } from '../schedules/schedules.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import { FirebaseService } from '../firebase/firebase.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { OrderStatus } from '../common/enums/order-status.enum';
import { ScheduleStatus } from '../common/enums/schedule-status.enum';
import type { User } from '../common/interfaces/user.interface';
import { ProcessPaymentDto } from './dto/process-payment.dto';
import { GenerateFinalPaymentDto } from './dto/generate-final-payment.dto';
import { DepositLinkDto } from './dto/deposit-link.dto';
import { RefundOrderDto } from './dto/refund-order.dto';
import type { Order } from '../common/interfaces/order.interface';
import * as admin from 'firebase-admin';

interface WebhookBody {
  type: string;
  data: { id: string };
}

interface FirestorePaymentData {
  status: string;
  type: string;
}

interface ScheduleGroup {
  scheduledDate: Date;
  teamId: string;
  timeSlot: string;
  services: Array<{ serviceId: string; serviceName: string }>;
}

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private paymentsService: PaymentsService,
    private ordersService: OrdersService,
    private schedulesService: SchedulesService,
    private notificationsService: NotificationsService,
    private usersService: UsersService,
    private firebaseService: FirebaseService,
  ) {}

  /**
   * Processar pagamento de depósito (30%)
   */
  @Post('process-deposit')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async processDeposit(
    @Body() dto: ProcessPaymentDto,
    @CurrentUser() user: User,
  ) {
    const { orderId, paymentData } = dto;

    // 1. Buscar pedido
    const order = await this.ordersService.findOne(orderId);

    // Verificar se é o dono do pedido
    if (order.userId !== user.uid) {
      throw new ForbiddenException('Você não tem permissão para este pedido');
    }

    // Verificar status
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException('Pedido já foi processado');
    }

    // 2. Processar pagamento
    const paymentResult = await this.paymentsService.createDirectPayment({
      amount: order.depositAmount,
      description: `Depósito - Pedido #${orderId.substring(0, 8)}`,
      paymentMethodId: paymentData.method,
      token: paymentData.token,
      email: user.email,
      metadata: {
        orderId,
        type: 'DEPOSIT',
        userId: user.uid,
      },
    });

    if (paymentResult.status !== 'approved') {
      throw new BadRequestException(
        `Pagamento não aprovado: ${paymentResult.statusDetail}`,
      );
    }

    // 3. Agrupar items por (scheduledDate + teamId + timeSlot)
    const groupMap = new Map<string, ScheduleGroup>();
    for (const item of order.items) {
      const key = `${item.scheduledDate}|${item.teamId}|${item.timeSlot}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          scheduledDate: new Date(item.scheduledDate),
          teamId: item.teamId,
          timeSlot: item.timeSlot,
          services: [],
        });
      }
      groupMap.get(key)!.services.push({
        serviceId: item.serviceId,
        serviceName: item.serviceName,
      });
    }

    // 4. Verificar conflitos para todos os grupos
    for (const group of groupMap.values()) {
      const hasConflict = await this.schedulesService.checkConflict(
        group.teamId,
        group.scheduledDate,
        group.timeSlot,
      );
      if (hasConflict) {
        throw new BadRequestException(
          `Já existe um agendamento para a equipe no horário ${group.timeSlot} na data ${group.scheduledDate.toLocaleDateString('pt-BR')}`,
        );
      }
    }

    // 5. Transação atômica: atualizar pedido + registrar pagamento + criar agendamentos
    const db = this.firebaseService.getFirestore();
    const scheduleIds: string[] = [];

    await db.runTransaction((transaction) => {
      const orderRef = db.collection('orders').doc(orderId);

      // Atualizar status do pedido
      transaction.update(orderRef, {
        status: OrderStatus.DEPOSIT_PAID,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Registrar pagamento
      const paymentRef = orderRef.collection('payments').doc();
      transaction.set(paymentRef, {
        amount: order.depositAmount,
        type: 'DEPOSIT',
        status: 'COMPLETED',
        paymentMethod: paymentData.method,
        transactionId: paymentResult.transactionId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Criar um schedule por grupo (data+equipe+slot)
      for (const group of groupMap.values()) {
        const scheduleRef = db.collection('schedules').doc();
        scheduleIds.push(scheduleRef.id);

        transaction.set(scheduleRef, {
          orderId,
          userId: user.uid,
          teamId: group.teamId,
          scheduledDate: admin.firestore.Timestamp.fromDate(
            group.scheduledDate,
          ),
          timeSlot: group.timeSlot,
          status: ScheduleStatus.PENDING,
          notes: '',
          peopleCount: order.peopleCount,
          services: group.services,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      return Promise.resolve();
    });

    // 6. Buscar dados do usuário e enviar WhatsApp
    const userData = await this.usersService.findOne(order.userId);

    try {
      const datesSummary = Array.from(groupMap.values())
        .map(
          (g) =>
            `${g.scheduledDate.toLocaleDateString('pt-BR')} às ${g.timeSlot}`,
        )
        .join('\n');

      const documents = order.items
        .map((item) => `• ${item.serviceName}`)
        .join('\n');

      await this.notificationsService.sendWhatsApp(
        userData.phone,
        'order_confirmation',
        {
          name: userData.name,
          orderNumber: orderId.substring(0, 8),
          scheduledDate: datesSummary,
          depositPaid: order.depositAmount.toFixed(2),
          documents: documents || '• RG ou CNH\n• CPF',
        },
      );

      await this.ordersService.addNotification(orderId, {
        type: 'WHATSAPP',
        message: 'Confirmação de pedido enviada',
        status: 'SENT',
      });
    } catch (error) {
      this.logger.error(
        'Erro ao enviar WhatsApp',
        error instanceof Error ? error.stack : String(error),
      );
    }

    return {
      success: true,
      scheduleIds,
      message: 'Pagamento processado com sucesso!',
    };
  }

  /**
   * Gerar link de pagamento do depósito (30%) via Mercado Pago Checkout Pro
   */
  @Post('deposit-link')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async createDepositLink(
    @Body() dto: DepositLinkDto,
    @CurrentUser() user: User,
  ) {
    const { orderId } = dto;

    const order = await this.ordersService.findOne(orderId);

    if (order.userId !== user.uid) {
      throw new ForbiddenException('Você não tem permissão para este pedido');
    }

    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException('Pedido já foi processado');
    }

    const result = await this.paymentsService.createPaymentLink({
      amount: order.depositAmount,
      description: `Entrada - Pedido #${orderId.substring(0, 8)}`,
      orderId,
      type: 'DEPOSIT',
      customerEmail: user.email,
    });

    return {
      success: true,
      paymentLink: result.paymentLink,
    };
  }

  /**
   * Gerar link de pagamento final (70%)
   * Apenas EMPLOYEE e ADMIN
   */
  @Post('generate-final')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.EMPLOYEE, UserRole.ADMIN)
  async generateFinalPayment(
    @Body() dto: GenerateFinalPaymentDto,
    @CurrentUser() user: User,
  ) {
    const { orderId, paymentMethod } = dto;

    // 1. Buscar pedido e verificar permissão
    const order = await this.ordersService.findOne(orderId);

    // Apenas admin pode gerar pagamento final de qualquer pedido
    if (user.role !== UserRole.ADMIN && order.userId !== user.uid) {
      throw new ForbiddenException('Você não tem permissão para este pedido');
    }

    // Verificar status
    if (order.status === OrderStatus.COMPLETED) {
      throw new BadRequestException('Pedido já foi finalizado');
    }

    if (
      order.status !== OrderStatus.DEPOSIT_PAID &&
      order.status !== OrderStatus.SCHEDULED
    ) {
      throw new BadRequestException(
        'Pedido precisa ter o depósito pago primeiro',
      );
    }

    // 2. Buscar dados do cliente
    const customer = await this.usersService.findOne(order.userId);

    // 3. Gerar link de pagamento
    const paymentLinkResult = await this.paymentsService.createPaymentLink({
      amount: order.remainingAmount,
      description: `Pagamento final - Pedido #${orderId.substring(0, 8)}`,
      orderId,
      type: 'FINAL',
      customerEmail: customer.email,
    });

    // 4. Enviar WhatsApp
    try {
      await this.notificationsService.sendWhatsApp(
        customer.phone,
        'final_payment',
        {
          name: customer.name,
          amount: order.remainingAmount.toFixed(2),
          paymentLink: paymentLinkResult.paymentLink,
        },
      );
    } catch (error) {
      this.logger.error(
        'Erro ao enviar WhatsApp',
        error instanceof Error ? error.stack : String(error),
      );
    }

    // 5. Registrar pagamento pendente
    await this.ordersService.addPayment(orderId, {
      amount: order.remainingAmount,
      type: 'FINAL',
      status: 'PENDING',
      paymentMethod,
      paymentLink: paymentLinkResult.paymentLink,
    });

    return {
      success: true,
      paymentLink: paymentLinkResult.paymentLink,
      message: 'Link de pagamento gerado e enviado para o cliente',
    };
  }

  /**
   * Reembolsar pedido (cancelamento com reembolso)
   */
  @Post('refund')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async refundOrder(
    @Body() dto: RefundOrderDto,
    @CurrentUser() user: User,
  ) {
    const { orderId } = dto;
    const order = await this.ordersService.findOne(orderId);

    // Apenas dono do pedido ou admin pode reembolsar
    if (user.role !== UserRole.ADMIN && order.userId !== user.uid) {
      throw new ForbiddenException('Você não tem permissão para este pedido');
    }

    // Verificar se pedido pode ser reembolsado
    if (
      order.status === OrderStatus.COMPLETED ||
      order.status === OrderStatus.CANCELLED ||
      order.status === OrderStatus.REFUNDED
    ) {
      throw new BadRequestException(
        `Pedido não pode ser reembolsado (status: ${order.status})`,
      );
    }

    // Se tem depósito pago, reembolsar via Mercado Pago
    if (
      order.status === OrderStatus.DEPOSIT_PAID ||
      order.status === OrderStatus.SCHEDULED
    ) {
      // Buscar transactionId do pagamento de depósito
      const db = this.firebaseService.getFirestore();
      const paymentsSnap = await db
        .collection('orders')
        .doc(orderId)
        .collection('payments')
        .where('type', '==', 'DEPOSIT')
        .where('status', '==', 'COMPLETED')
        .limit(1)
        .get();

      if (!paymentsSnap.empty) {
        const paymentDoc = paymentsSnap.docs[0];
        const transactionId = paymentDoc.data().transactionId as string;

        if (transactionId && !transactionId.startsWith('mock')) {
          await this.paymentsService.refundPayment(transactionId);
        }

        await paymentDoc.ref.update({
          status: 'REFUNDED',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // Cancelar agendamentos associados
      const schedulesSnap = await db
        .collection('schedules')
        .where('orderId', '==', orderId)
        .get();

      for (const doc of schedulesSnap.docs) {
        const scheduleData = doc.data();
        if (scheduleData.status !== 'CANCELLED') {
          await doc.ref.update({
            status: ScheduleStatus.CANCELLED,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      }
    }

    // Atualizar status do pedido
    const newStatus =
      order.status === OrderStatus.PENDING
        ? OrderStatus.CANCELLED
        : OrderStatus.REFUNDED;

    await this.ordersService.updateStatus(orderId, newStatus);

    this.logger.log(
      `Pedido ${orderId} ${newStatus === OrderStatus.REFUNDED ? 'reembolsado' : 'cancelado'} por ${user.uid}`,
    );

    // Notificar cliente
    try {
      const customer = await this.usersService.findOne(order.userId);
      await this.notificationsService.sendWhatsApp(
        customer.phone,
        'order_cancelled',
        {
          name: customer.name,
          orderNumber: orderId.substring(0, 8),
        },
      );
    } catch (error) {
      this.logger.error(
        'Erro ao enviar WhatsApp de cancelamento',
        error instanceof Error ? error.stack : String(error),
      );
    }

    return {
      success: true,
      status: newStatus,
      message:
        newStatus === OrderStatus.REFUNDED
          ? 'Pedido reembolsado com sucesso'
          : 'Pedido cancelado com sucesso',
    };
  }

  /**
   * Webhook do Mercado Pago (rota pública, validada por assinatura)
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async handleWebhook(
    @Body() body: WebhookBody,
    @Headers('x-signature') signature: string,
    @Headers('x-request-id') requestId: string,
  ) {
    this.logger.log(`Webhook recebido: ${JSON.stringify(body)}`);

    // Validar assinatura do Mercado Pago
    if (!this.validateWebhookSignature(signature, requestId, body)) {
      this.logger.warn('Webhook com assinatura inválida rejeitado');
      return { status: 'ignored' };
    }

    const { type, data } = body;

    if (type !== 'payment') {
      return { status: 'ignored' };
    }

    try {
      const paymentId = data.id;

      // Buscar status do pagamento no Mercado Pago
      const paymentStatus =
        await this.paymentsService.getPaymentStatus(paymentId);

      this.logger.log(
        `Pagamento ${paymentId} - Status: ${paymentStatus.status}`,
      );

      if (paymentStatus.status !== 'approved') {
        return { status: 'ignored' };
      }

      // Flow 1: Pagamento direto (process-deposit) — busca por transactionId
      const db = this.firebaseService.getFirestore();
      const paymentsSnapshot = await db
        .collectionGroup('payments')
        .where('transactionId', '==', paymentId.toString())
        .limit(1)
        .get();

      if (!paymentsSnapshot.empty) {
        const paymentDoc = paymentsSnapshot.docs[0];
        const paymentData = paymentDoc.data() as FirestorePaymentData;
        const orderId = paymentDoc.ref.parent.parent?.id ?? '';

        if (paymentData.status === 'COMPLETED') {
          this.logger.log(`Pagamento ${paymentId} já processado, ignorando`);
          return { status: 'ok' };
        }

        this.logger.log(`Atualizando pedido ${orderId} (pagamento direto)`);

        await paymentDoc.ref.update({
          status: 'COMPLETED',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        if (paymentData.type === 'FINAL') {
          await this.handleFinalApproved(orderId);
        }

        return { status: 'ok' };
      }

      // Flow 2: Checkout Pro — usa external_reference (orderId:TYPE)
      if (paymentStatus.externalReference) {
        const [orderId, paymentType] =
          paymentStatus.externalReference.split(':');

        this.logger.log(
          `Checkout Pro: pedido ${orderId}, tipo ${paymentType}`,
        );

        if (paymentType === 'DEPOSIT') {
          await this.handleDepositApproved(orderId, paymentId.toString());
        } else if (paymentType === 'FINAL') {
          await this.handleFinalApproved(orderId);
        }

        return { status: 'ok' };
      }

      this.logger.warn(
        `Pagamento ${paymentId} aprovado mas sem referência no Firestore`,
      );
      return { status: 'not_found' };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Erro desconhecido';
      this.logger.error(
        'Erro no webhook',
        error instanceof Error ? error.stack : String(error),
      );
      return { status: 'error', error: message };
    }
  }

  /**
   * Processar depósito aprovado via Checkout Pro (webhook)
   */
  private async handleDepositApproved(
    orderId: string,
    transactionId: string,
  ): Promise<void> {
    const order = await this.ordersService.findOne(orderId);

    // Idempotência
    if (order.status !== OrderStatus.PENDING) {
      this.logger.log(
        `Pedido ${orderId} já processado (${order.status}), ignorando`,
      );
      return;
    }

    // Agrupar items por (scheduledDate + teamId + timeSlot)
    const groupMap = this.groupOrderItems(order);

    // Verificar conflitos
    for (const group of groupMap.values()) {
      const hasConflict = await this.schedulesService.checkConflict(
        group.teamId,
        group.scheduledDate,
        group.timeSlot,
      );
      if (hasConflict) {
        this.logger.error(
          `Conflito de agendamento para pedido ${orderId}: ${group.timeSlot}`,
        );
        // Não podemos lançar exceção no webhook, apenas logar
        return;
      }
    }

    // Transação atômica
    const db = this.firebaseService.getFirestore();

    await db.runTransaction((transaction) => {
      const orderRef = db.collection('orders').doc(orderId);

      transaction.update(orderRef, {
        status: OrderStatus.DEPOSIT_PAID,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const paymentRef = orderRef.collection('payments').doc();
      transaction.set(paymentRef, {
        amount: order.depositAmount,
        type: 'DEPOSIT',
        status: 'COMPLETED',
        paymentMethod: 'mercadopago_checkout',
        transactionId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      for (const group of groupMap.values()) {
        const scheduleRef = db.collection('schedules').doc();
        transaction.set(scheduleRef, {
          orderId,
          userId: order.userId,
          teamId: group.teamId,
          scheduledDate: admin.firestore.Timestamp.fromDate(
            group.scheduledDate,
          ),
          timeSlot: group.timeSlot,
          status: ScheduleStatus.PENDING,
          notes: '',
          peopleCount: order.peopleCount,
          services: group.services,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      return Promise.resolve();
    });

    this.logger.log(`Depósito aprovado para pedido ${orderId}`);

    // Enviar WhatsApp
    try {
      const userData = await this.usersService.findOne(order.userId);

      const datesSummary = Array.from(groupMap.values())
        .map(
          (g) =>
            `${g.scheduledDate.toLocaleDateString('pt-BR')} às ${g.timeSlot}`,
        )
        .join('\n');

      const documents = order.items
        .map((item) => `• ${item.serviceName}`)
        .join('\n');

      await this.notificationsService.sendWhatsApp(
        userData.phone,
        'order_confirmation',
        {
          name: userData.name,
          orderNumber: orderId.substring(0, 8),
          scheduledDate: datesSummary,
          depositPaid: order.depositAmount.toFixed(2),
          documents: documents || '• RG ou CNH\n• CPF',
        },
      );

      await this.ordersService.addNotification(orderId, {
        type: 'WHATSAPP',
        message: 'Confirmação de pedido enviada',
        status: 'SENT',
      });
    } catch (error) {
      this.logger.error(
        'Erro ao enviar WhatsApp',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Processar pagamento final aprovado (webhook)
   */
  private async handleFinalApproved(orderId: string): Promise<void> {
    await this.ordersService.updateStatus(orderId, OrderStatus.COMPLETED);

    const order = await this.ordersService.findOne(orderId);
    const customer = await this.usersService.findOne(order.userId);

    try {
      await this.notificationsService.sendWhatsApp(
        customer.phone,
        'service_completed',
        {
          name: customer.name,
          orderNumber: orderId.substring(0, 8),
        },
      );

      await this.ordersService.addNotification(orderId, {
        type: 'WHATSAPP',
        message: 'Serviço concluído',
        status: 'SENT',
      });
    } catch (error) {
      this.logger.error(
        'Erro ao enviar WhatsApp',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Agrupar items do pedido por (scheduledDate + teamId + timeSlot)
   */
  private groupOrderItems(order: Order): Map<string, ScheduleGroup> {
    const groupMap = new Map<string, ScheduleGroup>();

    for (const item of order.items) {
      const key = `${item.scheduledDate}|${item.teamId}|${item.timeSlot}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          scheduledDate: new Date(item.scheduledDate),
          teamId: item.teamId,
          timeSlot: item.timeSlot,
          services: [],
        });
      }
      groupMap.get(key)!.services.push({
        serviceId: item.serviceId,
        serviceName: item.serviceName,
      });
    }

    return groupMap;
  }

  private validateWebhookSignature(
    signature: string,
    requestId: string,
    body: WebhookBody,
  ): boolean {
    const secret = Environment.getOptionalVar('MERCADOPAGO_WEBHOOK_SECRET');

    // Em produção, rejeitar webhooks sem segredo configurado
    if (!secret) {
      const env = Environment.getOptionalVar('APP_ENV');
      if (env === 'production') {
        this.logger.error('MERCADOPAGO_WEBHOOK_SECRET não configurado em produção');
        return false;
      }
      return true;
    }

    if (!signature || !requestId) return false;

    // Parsear x-signature: ts=...,v1=...
    const parts = signature
      .split(',')
      .reduce<Record<string, string>>((acc, part) => {
        const eqIdx = part.indexOf('=');
        if (eqIdx > 0) {
          const key = part.substring(0, eqIdx);
          const value = part.substring(eqIdx + 1);
          acc[key] = value;
        }
        return acc;
      }, {});

    const ts = parts['ts'];
    const v1 = parts['v1'];

    if (!ts || !v1) return false;

    const template = `id:${body.data.id};request-id:${requestId};ts:${ts};`;
    const hash = createHmac('sha256', secret).update(template).digest('hex');

    return hash === v1;
  }
}
