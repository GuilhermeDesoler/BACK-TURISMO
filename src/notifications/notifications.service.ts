import { Injectable, Logger } from '@nestjs/common';
import { Twilio } from 'twilio';
import * as nodemailer from 'nodemailer';
import { Environment } from '../common/config/environment';

export type WhatsAppTemplate =
  | 'order_confirmation'
  | 'final_payment'
  | 'service_completed'
  | 'order_cancelled'
  | 'invoice_sent';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private twilioClient: Twilio | null = null;
  private whatsappNumber = '';
  private emailTransporter: nodemailer.Transporter | null = null;
  private emailFrom = '';

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

    const smtpHost = Environment.getOptionalVar('SMTP_HOST');
    const smtpPort = Environment.getOptionalVar('SMTP_PORT');
    const smtpUser = Environment.getOptionalVar('SMTP_USER');
    const smtpPass = Environment.getOptionalVar('SMTP_PASS');
    const smtpFrom = Environment.getOptionalVar('SMTP_FROM');

    if (smtpHost && smtpUser && smtpPass) {
      this.emailTransporter = nodemailer.createTransport({
        host: smtpHost,
        port: Number(smtpPort) || 587,
        secure: (Number(smtpPort) || 587) === 465,
        auth: { user: smtpUser, pass: smtpPass },
      });
      this.emailFrom = smtpFrom || smtpUser;
      this.logger.log('Email configurado via SMTP');
    } else {
      this.logger.warn(
        'SMTP nao configurado - notificacoes por email desabilitadas',
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

    order_cancelled: `
Olá {name},

Seu pedido #{orderNumber} foi cancelado.

Caso tenha sido realizado algum pagamento, o reembolso será processado em até 10 dias úteis.

Em caso de dúvidas, entre em contato conosco.

Obrigado pela compreensão!
    `.trim(),

    invoice_sent: `
Olá {name}! 📄

Sua Nota Fiscal referente ao pedido #{orderNumber} foi emitida!

Número da NF-e: {invoiceNumber}
Valor: R$ {amount}

{deliveryNote}

Obrigado pela preferência! 🌴
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

  async sendEmail(
    to: string,
    subject: string,
    html: string,
    attachments?: Array<{
      filename: string;
      content: Buffer;
      contentType?: string;
    }>,
  ): Promise<void> {
    if (!this.emailTransporter) {
      this.logger.warn(
        `[MOCK] Email para ${to} (assunto: ${subject})`,
      );
      return;
    }

    try {
      await this.emailTransporter.sendMail({
        from: this.emailFrom,
        to,
        subject,
        html,
        attachments,
      });
      this.logger.log(`Email enviado para ${to}`);
    } catch (error) {
      this.logger.error(
        'Erro ao enviar email',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private formatPhone(phone: string): string {
    const cleaned = phone.replace(/\D/g, '');
    return cleaned.startsWith('55') ? `+${cleaned}` : `+55${cleaned}`;
  }
}
