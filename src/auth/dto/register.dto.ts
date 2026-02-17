import { IsString, IsEmail } from 'class-validator';

export class RegisterDto {
  @IsString()
  uid: string;

  @IsEmail()
  email: string;

  @IsString()
  name: string;

  @IsString()
  phone: string;
}
