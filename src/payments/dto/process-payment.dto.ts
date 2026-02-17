import { IsString, IsObject, IsOptional } from 'class-validator';

class PaymentDataDto {
  @IsString()
  method: string;

  @IsString()
  token: string;

  @IsOptional()
  @IsString()
  installments?: string;
}

export class ProcessPaymentDto {
  @IsString()
  orderId: string;

  @IsObject()
  paymentData: PaymentDataDto;
}
