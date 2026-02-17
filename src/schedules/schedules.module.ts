import { Module } from '@nestjs/common';
import { FirebaseModule } from '../firebase/firebase.module';
import { TeamsModule } from '../teams/teams.module';
import { SchedulesController } from './schedules.controller';
import { SchedulesService } from './schedules.service';

@Module({
  imports: [FirebaseModule, TeamsModule],
  controllers: [SchedulesController],
  providers: [SchedulesService],
  exports: [SchedulesService],
})
export class SchedulesModule {}
