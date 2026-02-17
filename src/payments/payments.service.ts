import { Injectable, Logger } from '@nestjs/common';
import { MercadoPagoConfig, Payment, Preference } from 'mercadopago';
import { Environment } from '../common/config/environment';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private paymentClient: Payment | null = null;
  private preferenceClient: Preference | null = null;
  private readonly mockMode: boolean;

  constructor() {
    const accessToken = Environment.getOptionalVar('MERCADOPAGO_ACCESS_TOKEN');

    if (accessToken) {
      const client = new MercadoPagoConfig({ accessToken });
      this.paymentClient = new Payment(client);
      this.preferenceClient = new Preference(client);
      this.mockMode = false;
    } else {
      this.logger.warn('MercadoPago nao configurado - pagamentos em modo MOCK');
      this.mockMode = true;
    }
  }

  /**
   * Criar pagamento direto (cartão de crédito)
   */
  async createDirectPayment(data: {
    amount: number;
    description: string;
    paymentMethodId: string;
    token: string;
    email: string;
    metadata?: Record<string, string>;
  }) {
    if (this.mockMode) {
      this.logger.warn(
        `[MOCK] Pagamento direto: R$ ${data.amount} - ${data.description}`,
      );
      return {
        success: true,
        paymentId: `mock-${Date.now()}`,
        status: 'approved' as const,
        statusDetail: 'mock_approved',
        transactionId: `mock-tx-${Date.now()}`,
      };
    }

    try {
      const payment = await this.paymentClient!.create({
        body: {
          transaction_amount: data.amount,
          description: data.description,
          payment_method_id: data.paymentMethodId,
          token: data.token,
          payer: {
            email: data.email,
          },
          metadata: data.metadata || {},
        },
      });

      return {
        success: true,
        paymentId: payment.id,
        status: payment.status,
        statusDetail: payment.status_detail,
        transactionId: payment.id?.toString(),
      };
    } catch (error) {
      this.logger.error(
        'Erro ao criar pagamento',
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Criar link de pagamento
   */
  async createPaymentLink(data: {
    amount: number;
    description: string;
    orderId: string;
    type: 'DEPOSIT' | 'FINAL';
    customerEmail: string;
  }) {
    if (this.mockMode) {
      this.logger.warn(
        `[MOCK] Link de pagamento: R$ ${data.amount} - ${data.description}`,
      );
      return {
        success: true,
        preferenceId: `mock-pref-${Date.now()}`,
        paymentLink: `http://localhost:3000/mock-payment?order=${data.orderId}&amount=${data.amount}`,
      };
    }

    try {
      const appUrl = Environment.getVar('APP_URL');

      const preference = await this.preferenceClient!.create({
        body: {
          items: [
            {
              id: data.orderId,
              title: data.description,
              quantity: 1,
              unit_price: data.amount,
              currency_id: 'BRL',
            },
          ],
          payer: {
            email: data.customerEmail,
          },
          back_urls: {
            success: `${appUrl}/confirmacao/${data.orderId}?status=success`,
            failure: `${appUrl}/confirmacao/${data.orderId}?status=failure`,
            pending: `${appUrl}/confirmacao/${data.orderId}?status=pending`,
          },
          auto_return: 'approved',
          metadata: {
            orderId: data.orderId,
            type: data.type,
          },
          notification_url: `${appUrl}/api/payments/webhook`,
        },
      });

      return {
        success: true,
        preferenceId: preference.id,
        paymentLink:
          preference.init_point ?? preference.sandbox_init_point ?? '',
      };
    } catch (error) {
      this.logger.error(
        'Erro ao criar link',
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Buscar status do pagamento
   */
  async getPaymentStatus(paymentId: string) {
    if (this.mockMode) {
      return {
        status: 'approved',
        statusDetail: 'mock_approved',
        amount: 0,
      };
    }

    try {
      const payment = await this.paymentClient!.get({ id: paymentId });

      return {
        status: payment.status,
        statusDetail: payment.status_detail,
        amount: payment.transaction_amount,
      };
    } catch (error) {
      this.logger.error(
        'Erro ao buscar pagamento',
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }
}
