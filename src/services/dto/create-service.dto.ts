import {
  IsString,
  IsNumber,
  IsBoolean,
  IsArray,
  Min,
  Max,
  IsOptional,
  IsUrl,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateServiceDto {
  @ApiProperty({
    description: 'Nome do serviço',
    example: 'Passeio de Barco',
  })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'Descrição detalhada do serviço',
    example: 'Passeio de 3 horas pelas ilhas',
  })
  @IsString()
  description: string;

  @ApiProperty({
    description: 'Preço do serviço em reais',
    example: 250.0,
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiProperty({
    description: 'Número máximo de pessoas',
    example: 4,
    minimum: 1,
    maximum: 4,
  })
  @IsNumber()
  @Min(1)
  @Max(4)
  maxPeople: number;

  @ApiProperty({
    description: 'Duração do serviço em minutos',
    example: 180,
    minimum: 30,
  })
  @IsNumber()
  @Min(30)
  duration: number;

  @ApiPropertyOptional({
    description: 'Se o serviço está ativo',
    example: true,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean = true;

  @ApiPropertyOptional({
    description: 'Documentos necessários',
    example: ['RG', 'CPF'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  requiresDocuments?: string[] = [];

  @ApiPropertyOptional({
    description: 'URLs das imagens do serviço',
    example: ['https://example.com/image1.jpg'],
    type: [String],
  })
  @IsArray()
  @IsUrl({}, { each: true })
  @IsOptional()
  imageUrls?: string[] = [];
}
