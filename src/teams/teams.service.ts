import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { Team, TeamOperatingHours } from '../common/interfaces/team.interface';
import * as admin from 'firebase-admin';

interface FirestoreTeamData {
  name: string;
  isActive: boolean;
  maxPeople: number;
  operatingHours: TeamOperatingHours[];
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
}

@Injectable()
export class TeamsService {
  private readonly logger = new Logger(TeamsService.name);

  constructor(private firebaseService: FirebaseService) {}

  async create(data: {
    name: string;
    isActive?: boolean;
    maxPeople: number;
    operatingHours: TeamOperatingHours[];
  }): Promise<string> {
    this.validateOperatingHours(data.operatingHours);

    const db = this.firebaseService.getFirestore();

    const plainHours = data.operatingHours.map((h) => ({
      dayOfWeek: h.dayOfWeek,
      startTime: h.startTime,
      endTime: h.endTime,
      slotDurationMinutes: h.slotDurationMinutes,
    }));

    const teamRef = await db.collection('teams').add({
      name: data.name,
      isActive: data.isActive ?? true,
      maxPeople: data.maxPeople,
      operatingHours: plainHours,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    this.logger.log(`Equipe "${data.name}" criada (${teamRef.id})`);
    return teamRef.id;
  }

  async findOne(teamId: string): Promise<Team> {
    const db = this.firebaseService.getFirestore();
    const doc = await db.collection('teams').doc(teamId).get();

    if (!doc.exists) {
      throw new NotFoundException('Equipe não encontrada');
    }

    return this.mapDoc(doc);
  }

  async findAll(): Promise<Team[]> {
    const db = this.firebaseService.getFirestore();
    const snapshot = await db
      .collection('teams')
      .orderBy('createdAt', 'asc')
      .get();

    return snapshot.docs.map((doc) => this.mapDoc(doc));
  }

  async findActive(): Promise<Team[]> {
    const db = this.firebaseService.getFirestore();
    const snapshot = await db
      .collection('teams')
      .where('isActive', '==', true)
      .orderBy('createdAt', 'asc')
      .get();

    return snapshot.docs.map((doc) => this.mapDoc(doc));
  }

  async update(
    teamId: string,
    data: {
      name?: string;
      isActive?: boolean;
      maxPeople?: number;
      operatingHours?: TeamOperatingHours[];
    },
  ): Promise<void> {
    const db = this.firebaseService.getFirestore();
    const ref = db.collection('teams').doc(teamId);
    const doc = await ref.get();

    if (!doc.exists) {
      throw new NotFoundException('Equipe não encontrada');
    }

    if (data.operatingHours) {
      this.validateOperatingHours(data.operatingHours);
    }

    const updateData: Record<string, unknown> = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (data.name !== undefined) updateData['name'] = data.name;
    if (data.isActive !== undefined) updateData['isActive'] = data.isActive;
    if (data.maxPeople !== undefined) updateData['maxPeople'] = data.maxPeople;
    if (data.operatingHours !== undefined)
      updateData['operatingHours'] = data.operatingHours.map((h) => ({
        dayOfWeek: h.dayOfWeek,
        startTime: h.startTime,
        endTime: h.endTime,
        slotDurationMinutes: h.slotDurationMinutes,
      }));

    await ref.update(updateData);
    this.logger.log(`Equipe ${teamId} atualizada`);
  }

  /**
   * Gerar os time slots disponíveis para uma equipe em uma data específica
   */
  getTimeSlotsForDate(team: Team, date: Date): string[] {
    const dayOfWeek = date.getDay();
    const hours = team.operatingHours.filter((h) => h.dayOfWeek === dayOfWeek);

    if (hours.length === 0) return [];

    const slots: string[] = [];

    for (const h of hours) {
      const [startH, startM] = h.startTime.split(':').map(Number);
      const [endH, endM] = h.endTime.split(':').map(Number);
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;

      for (
        let m = startMinutes;
        m + h.slotDurationMinutes <= endMinutes;
        m += h.slotDurationMinutes
      ) {
        const hh = String(Math.floor(m / 60)).padStart(2, '0');
        const mm = String(m % 60).padStart(2, '0');
        slots.push(`${hh}:${mm}`);
      }
    }

    return [...new Set(slots)].sort();
  }

  private validateOperatingHours(hours: TeamOperatingHours[]): void {
    for (const h of hours) {
      const [startH, startM] = h.startTime.split(':').map(Number);
      const [endH, endM] = h.endTime.split(':').map(Number);
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;

      if (endMinutes <= startMinutes) {
        throw new BadRequestException(
          `Horário inválido para dia ${h.dayOfWeek}: endTime deve ser após startTime`,
        );
      }
    }
  }

  private mapDoc(
    doc: admin.firestore.DocumentSnapshot<admin.firestore.DocumentData>,
  ): Team {
    const data = doc.data() as FirestoreTeamData;
    return {
      id: doc.id,
      name: data.name,
      isActive: data.isActive,
      maxPeople: data.maxPeople || 0,
      operatingHours: data.operatingHours || [],
      createdAt: data.createdAt.toDate(),
      updatedAt: data.updatedAt.toDate(),
    };
  }
}
