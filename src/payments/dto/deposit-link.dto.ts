import { IsString } from 'class-validator';

export class DepositLinkDto {
  @IsString()
  orderId: string;
}
