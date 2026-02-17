import { IsString } from 'class-validator';

export class GenerateFinalPaymentDto {
  @IsString()
  orderId: string;

  @IsString()
  paymentMethod: string;
}
