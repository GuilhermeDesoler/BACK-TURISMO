import { Injectable, Logger } from '@nestjs/common';
import { Twilio } from 'twilio';
import { Environment } from '../common/config/environment';

export type WhatsAppTemplate =
  | 'order_confirmation'
  | 'final_payment'
  | 'service_completed';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private twilioClient: Twilio | null = null;
  private whatsappNumber = '';

  constructor() {
    const sid = Environment.getOptionalVar('TWILIO_ACCOUNT_SID');
    const token = Environment.getOptionalVar('TWILIO_AUTH_TOKEN');
    const number = Environment.getOptionalVar('TWILIO_WHATSAPP_NUMBER');

    if (sid && token && number) {
      this.twilioClient = new Twilio(sid, token);
      this.whatsappNumber = number;
    } else {
      this.logger.warn(
        'Twilio nao configurado - notificacoes WhatsApp desabilitadas',
      );
    }
  }

  private templates: Record<WhatsAppTemplate, string> = {
    order_confirmation: `
Olá {name}! 🎉

Seu agendamento #{orderNumber} foi confirmado!

📅 Datas:
{scheduledDate}
💰 Sinal pago: R$ {depositPaid}

📋 DOCUMENTOS NECESSÁRIOS:
{documents}

Em breve, nossa equipe entrará em contato para confirmar os detalhes finais.

Obrigado por escolher nossa empresa! 🌴
    `.trim(),

    final_payment: `
Olá {name}!

Está na hora de finalizar seu pagamento! 💳

💰 Valor restante: R$ {amount}

Clique no link abaixo para pagar:
{paymentLink}

Qualquer dúvida, estamos à disposição!
    `.trim(),

    service_completed: `
Olá {name}! ✅

Seu serviço #{orderNumber} foi concluído com sucesso!

Esperamos que tenha aproveitado bastante! 🌟

Avalie nossa experiência e volte sempre!
    `.trim(),
  };

  async sendWhatsApp(
    phone: string,
    template: WhatsAppTemplate,
    variables: Record<string, string>,
  ): Promise<void> {
    if (!this.twilioClient) {
      this.logger.warn(
        `[MOCK] WhatsApp para ${phone} (template: ${template}): ${JSON.stringify(variables)}`,
      );
      return;
    }

    try {
      let text = this.templates[template];

      // Substituir variáveis
      for (const [key, value] of Object.entries(variables)) {
        text = text.replace(new RegExp(`{${key}}`, 'g'), value);
      }

      const formattedPhone = this.formatPhone(phone);

      await this.twilioClient.messages.create({
        from: `whatsapp:${this.whatsappNumber}`,
        to: `whatsapp:${formattedPhone}`,
        body: text,
      });

      this.logger.log(`WhatsApp enviado para ${formattedPhone}`);
    } catch (error) {
      this.logger.error(
        'Erro ao enviar WhatsApp',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private formatPhone(phone: string): string {
    const cleaned = phone.replace(/\D/g, '');
    return cleaned.startsWith('55') ? `+${cleaned}` : `+55${cleaned}`;
  }
}
