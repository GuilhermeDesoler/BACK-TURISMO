import { ScheduleStatus } from '../enums/schedule-status.enum';

export interface ScheduleService {
  serviceId: string;
  serviceName: string;
}

export interface Schedule {
  id: string;
  orderId: string;
  userId: string;
  teamId: string;
  scheduledDate: Date;
  timeSlot: string; // "08:00", "10:00", etc.
  status: ScheduleStatus;
  notes: string;
  peopleCount: number;
  services: ScheduleService[];
  createdAt: Date;
  updatedAt: Date;
}
