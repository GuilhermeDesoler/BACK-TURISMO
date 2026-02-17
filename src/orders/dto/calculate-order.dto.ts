import {
  IsArray,
  IsNumber,
  Min,
  Max,
  ValidateNested,
  IsString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class OrderItemDto {
  @IsString()
  serviceId: string;

  @IsNumber()
  @Min(1)
  quantity: number;
}

export class CalculateOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @IsNumber()
  @Min(1)
  @Max(4)
  peopleCount: number;
}
