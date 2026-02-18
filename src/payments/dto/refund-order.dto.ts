import { IsString } from 'class-validator';

export class RefundOrderDto {
  @IsString()
  orderId: string;
}
