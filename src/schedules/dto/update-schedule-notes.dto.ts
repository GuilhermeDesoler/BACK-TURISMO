import { IsString } from 'class-validator';

export class UpdateScheduleNotesDto {
  @IsString()
  notes: string;
}
