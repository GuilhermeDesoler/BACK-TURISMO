import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { OrdersService } from '../orders/orders.service';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { EmitInvoiceDto, InvoiceDelivery } from './dto/emit-invoice.dto';

@Controller('invoices')
export class InvoicesController {
  private readonly logger = new Logger(InvoicesController.name);

  constructor(
    private invoicesService: InvoicesService,
    private ordersService: OrdersService,
    private usersService: UsersService,
    private notificationsService: NotificationsService,
  ) {}

  @Post('emit')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.EMPLOYEE)
  async emitInvoice(@Body() dto: EmitInvoiceDto) {
    const { orderId, delivery } = dto;

    const order = await this.ordersService.findOne(orderId);

    if (order.status !== 'COMPLETED' && order.status !== 'SCHEDULED') {
      throw new BadRequestException(
        'NF-e só pode ser emitida para pedidos concluídos ou agendados',
      );
    }

    // Verificar se já existe NF-e
    const existing = await this.invoicesService.getInvoiceByOrder(orderId);
    if (existing) {
      throw new BadRequestException(
        `NF-e já emitida para este pedido (Nº ${existing.number})`,
      );
    }

    const customer = await this.usersService.findOne(order.userId);

    const invoice = await this.invoicesService.emit({
      orderId,
      customerName: customer.name,
      customerCpf: customer.cpf || '',
      customerEmail: customer.email,
      items: order.items.map((item) => ({
        description: item.serviceName,
        quantity: item.quantity,
        unitPrice: item.price,
      })),
      totalAmount: order.totalAmount,
    });

    // Enviar NF-e ao cliente
    const sendEmail =
      delivery === InvoiceDelivery.EMAIL || delivery === InvoiceDelivery.BOTH;
    const sendWhatsApp =
      delivery === InvoiceDelivery.WHATSAPP || delivery === InvoiceDelivery.BOTH;

    if (sendEmail) {
      try {
        let attachments: Array<{
          filename: string;
          content: Buffer;
          contentType: string;
        }> = [];

        if (invoice.pdfUrl) {
          const pdfBuffer = await this.invoicesService.downloadPdf(
            invoice.pdfUrl,
          );
          attachments = [
            {
              filename: `NFe-${invoice.number}.pdf`,
              content: pdfBuffer,
              contentType: 'application/pdf',
            },
          ];
        }

        await this.notificationsService.sendEmail(
          customer.email,
          `NF-e #${invoice.number} - BW Turismo Foz`,
          `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #2563eb;">BW Turismo Foz</h2>
              <p>Olá <strong>${customer.name}</strong>,</p>
              <p>Sua Nota Fiscal referente ao pedido <strong>#${orderId.substring(0, 8)}</strong> foi emitida.</p>
              <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Número NF-e:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${invoice.number}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Valor Total:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">R$ ${order.totalAmount.toFixed(2)}</td></tr>
              </table>
              ${invoice.pdfUrl ? '<p>A NF-e está em anexo neste email.</p>' : '<p>A NF-e será enviada em breve.</p>'}
              <p style="color: #666; font-size: 12px; margin-top: 24px;">BW Turismo Foz - Foz do Iguaçu</p>
            </div>
          `,
          attachments,
        );
        this.logger.log(`NF-e enviada por email para ${customer.email}`);
      } catch (error) {
        this.logger.error(
          'Erro ao enviar NF-e por email',
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    if (sendWhatsApp) {
      try {
        await this.notificationsService.sendWhatsApp(
          customer.phone,
          'invoice_sent',
          {
            name: customer.name,
            orderNumber: orderId.substring(0, 8),
            invoiceNumber: invoice.number,
            amount: order.totalAmount.toFixed(2),
            deliveryNote: invoice.pdfUrl
              ? `Acesse sua NF-e: ${invoice.pdfUrl}`
              : 'A NF-e também foi enviada por email.',
          },
        );
        this.logger.log(`NF-e notificada via WhatsApp para ${customer.phone}`);
      } catch (error) {
        this.logger.error(
          'Erro ao enviar WhatsApp de NF-e',
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return {
      success: true,
      invoice: {
        number: invoice.number,
        status: invoice.status,
        pdfUrl: invoice.pdfUrl,
      },
      message: 'NF-e emitida e enviada ao cliente',
    };
  }

  @Get('order/:orderId')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.EMPLOYEE)
  async getByOrder(@Param('orderId') orderId: string) {
    const invoice = await this.invoicesService.getInvoiceByOrder(orderId);
    return { invoice };
  }
}
