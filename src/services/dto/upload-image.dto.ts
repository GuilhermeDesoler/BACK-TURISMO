import { IsString } from 'class-validator';

export class UploadImageDto {
  @IsString()
  serviceId: string;
}
