import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import axios from 'axios';
import { Environment } from '../common/config/environment';
import { FirebaseService } from '../firebase/firebase.service';
import * as admin from 'firebase-admin';

export interface InvoiceData {
  id: string;
  number: string;
  status: string;
  pdfUrl?: string;
  xmlUrl?: string;
}

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);
  private readonly apiToken: string | undefined;
  private readonly apiUrl: string;
  private readonly mockMode: boolean;

  constructor(private firebaseService: FirebaseService) {
    this.apiToken = Environment.getOptionalVar('NFE_API_TOKEN');
    this.apiUrl =
      Environment.getOptionalVar('NFE_API_URL') ||
      'https://api.focusnfe.com.br/v2';
    this.mockMode = !this.apiToken;

    if (this.mockMode) {
      this.logger.warn(
        'NFE_API_TOKEN nao configurado - NF-e em modo mock',
      );
    }
  }

  async emit(orderData: {
    orderId: string;
    customerName: string;
    customerCpf: string;
    customerEmail: string;
    items: Array<{
      description: string;
      quantity: number;
      unitPrice: number;
    }>;
    totalAmount: number;
  }): Promise<InvoiceData> {
    if (this.mockMode) {
      const mockInvoice: InvoiceData = {
        id: `mock-nfe-${Date.now()}`,
        number: `MOCK-${Math.floor(Math.random() * 100000)}`,
        status: 'autorizada',
        pdfUrl: undefined,
        xmlUrl: undefined,
      };

      this.logger.warn(
        `[MOCK] NF-e emitida: ${mockInvoice.number} para pedido ${orderData.orderId}`,
      );

      await this.saveInvoice(orderData.orderId, mockInvoice);
      return mockInvoice;
    }

    try {
      const nfeData = {
        natureza_operacao: 'Prestacao de Servicos de Turismo',
        tipo_documento: '1',
        finalidade_emissao: '1',
        cnpj_emitente: Environment.getOptionalVar('COMPANY_CNPJ'),
        nome_destinatario: orderData.customerName,
        cpf_destinatario: orderData.customerCpf.replace(/\D/g, ''),
        email_destinatario: orderData.customerEmail,
        items: orderData.items.map((item, index) => ({
          numero_item: index + 1,
          descricao: item.description,
          quantidade: item.quantity,
          valor_unitario: item.unitPrice.toFixed(2),
          valor_bruto: (item.quantity * item.unitPrice).toFixed(2),
        })),
        valor_total: orderData.totalAmount.toFixed(2),
      };

      const response = await axios.post(
        `${this.apiUrl}/nfse`,
        nfeData,
        {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      );

      const invoice: InvoiceData = {
        id: response.data.id,
        number: response.data.numero,
        status: response.data.status,
        pdfUrl: response.data.caminho_pdf_nota_fiscal,
        xmlUrl: response.data.caminho_xml_nota_fiscal,
      };

      this.logger.log(
        `NF-e emitida: ${invoice.number} para pedido ${orderData.orderId}`,
      );

      await this.saveInvoice(orderData.orderId, invoice);
      return invoice;
    } catch (error) {
      this.logger.error(
        'Erro ao emitir NF-e',
        error instanceof Error ? error.stack : String(error),
      );
      throw new BadRequestException('Erro ao emitir NF-e. Tente novamente.');
    }
  }

  async getInvoiceByOrder(orderId: string): Promise<InvoiceData | null> {
    const db = this.firebaseService.getFirestore();
    const snapshot = await db
      .collection('orders')
      .doc(orderId)
      .collection('invoices')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();

    if (snapshot.empty) return null;

    const doc = snapshot.docs[0];
    const data = doc.data();
    return {
      id: data.externalId,
      number: data.number,
      status: data.status,
      pdfUrl: data.pdfUrl,
      xmlUrl: data.xmlUrl,
    };
  }

  async downloadPdf(pdfUrl: string): Promise<Buffer> {
    if (!pdfUrl) {
      throw new BadRequestException('URL do PDF não disponível');
    }

    const response = await axios.get(pdfUrl, {
      responseType: 'arraybuffer',
      headers: this.apiToken
        ? { Authorization: `Bearer ${this.apiToken}` }
        : {},
      timeout: 15000,
    });

    return Buffer.from(response.data);
  }

  private async saveInvoice(
    orderId: string,
    invoice: InvoiceData,
  ): Promise<void> {
    const db = this.firebaseService.getFirestore();
    await db
      .collection('orders')
      .doc(orderId)
      .collection('invoices')
      .add({
        externalId: invoice.id,
        number: invoice.number,
        status: invoice.status,
        pdfUrl: invoice.pdfUrl || null,
        xmlUrl: invoice.xmlUrl || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
  }
}
