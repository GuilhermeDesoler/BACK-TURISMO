import {
  IsArray,
  IsNumber,
  IsDateString,
  IsString,
  ValidateNested,
  Matches,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateOrderItemDto {
  @IsString()
  serviceId: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsDateString()
  scheduledDate: string;

  @IsString()
  teamId: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'timeSlot deve estar no formato HH:mm',
  })
  timeSlot: string;
}

export class CreateOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];

  @IsNumber()
  @Min(1)
  @Max(4)
  peopleCount: number;
}
