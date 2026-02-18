import { IsString, IsOptional, IsEnum } from 'class-validator';

export enum InvoiceDelivery {
  EMAIL = 'email',
  WHATSAPP = 'whatsapp',
  BOTH = 'both',
}

export class EmitInvoiceDto {
  @IsString()
  orderId: string;

  @IsEnum(InvoiceDelivery)
  @IsOptional()
  delivery?: InvoiceDelivery = InvoiceDelivery.BOTH;
}
