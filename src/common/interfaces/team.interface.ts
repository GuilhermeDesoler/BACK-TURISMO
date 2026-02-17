export interface TeamOperatingHours {
  dayOfWeek: number; // 0 = domingo, 1 = segunda, ..., 6 = sábado
  startTime: string; // "08:00"
  endTime: string; // "17:00"
  slotDurationMinutes: number; // duração de cada slot (ex: 60, 120)
}

export interface Team {
  id: string;
  name: string;
  isActive: boolean;
  operatingHours: TeamOperatingHours[];
  createdAt: Date;
  updatedAt: Date;
}
