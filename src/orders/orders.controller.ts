import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { OrdersService } from './orders.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import type { User } from '../common/interfaces/user.interface';
import { CalculateOrderDto } from './dto/calculate-order.dto';
import { CreateOrderDto } from './dto/create-order.dto';

@Controller('orders')
export class OrdersController {
  constructor(
    private ordersService: OrdersService,
    private firebaseService: FirebaseService,
  ) {}

  /**
   * Calcular total do pedido (rota publica)
   */
  @Post('calculate')
  @HttpCode(HttpStatus.OK)
  async calculate(@Body() dto: CalculateOrderDto) {
    return this.ordersService.calculateTotal(dto);
  }

  /**
   * Criar pedido
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AuthGuard)
  async create(@Body() dto: CreateOrderDto, @CurrentUser() user: User) {
    return this.ordersService.create(user.uid, dto);
  }

  /**
   * Buscar pedidos do usuário logado
   */
  @Get('my-orders')
  @UseGuards(AuthGuard)
  async findMy(@CurrentUser() user: User) {
    return this.ordersService.findByUser(user.uid);
  }

  /**
   * Listar todos os pedidos (admin/employee)
   */
  @Get()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.EMPLOYEE, UserRole.ADMIN)
  async findAll() {
    return this.ordersService.findAll();
  }

  /**
   * Buscar pedido específico
   */
  @Get(':id')
  @UseGuards(AuthGuard)
  async findOne(@Param('id') id: string, @CurrentUser() user: User) {
    const order = await this.ordersService.findOne(id);

    // Cliente só pode ver seus próprios pedidos
    if (user.role === UserRole.CLIENT && order.userId !== user.uid) {
      throw new ForbiddenException(
        'Você não tem permissão para ver este pedido',
      );
    }

    return order;
  }

  /**
   * Buscar histórico de pagamentos do pedido
   */
  @Get(':id/payments')
  @UseGuards(AuthGuard)
  async findPayments(@Param('id') id: string, @CurrentUser() user: User) {
    const order = await this.ordersService.findOne(id);

    if (user.role === UserRole.CLIENT && order.userId !== user.uid) {
      throw new ForbiddenException(
        'Você não tem permissão para ver este pedido',
      );
    }

    const db = this.firebaseService.getFirestore();
    const snapshot = await db
      .collection('orders')
      .doc(id)
      .collection('payments')
      .orderBy('createdAt', 'desc')
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
  }
}
