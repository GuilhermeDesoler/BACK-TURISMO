import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { TeamsService } from '../teams/teams.service';
import { ScheduleStatus } from '../common/enums/schedule-status.enum';
import {
  Schedule,
  ScheduleService as ScheduleServiceItem,
} from '../common/interfaces/schedule.interface';
import * as admin from 'firebase-admin';

interface FirestoreScheduleData {
  orderId: string;
  userId: string;
  teamId: string;
  scheduledDate: admin.firestore.Timestamp;
  timeSlot: string;
  status: ScheduleStatus;
  notes: string;
  peopleCount: number;
  services: ScheduleServiceItem[];
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
}

@Injectable()
export class SchedulesService {
  private readonly logger = new Logger(SchedulesService.name);

  constructor(
    private firebaseService: FirebaseService,
    private teamsService: TeamsService,
  ) {}

  /**
   * Criar agendamento com validação de conflito por equipe + horário
   */
  async create(data: {
    orderId: string;
    userId: string;
    teamId: string;
    scheduledDate: Date;
    timeSlot: string;
    peopleCount: number;
    services: ScheduleServiceItem[];
  }): Promise<string> {
    // Validar que a equipe existe e está ativa
    const team = await this.teamsService.findOne(data.teamId);
    if (!team.isActive) {
      throw new BadRequestException('A equipe selecionada não está ativa');
    }

    // Validar que o timeSlot é válido para a equipe nessa data
    const availableSlots = this.teamsService.getTimeSlotsForDate(
      team,
      data.scheduledDate,
    );
    if (availableSlots.length === 0) {
      throw new BadRequestException('A equipe não opera neste dia da semana');
    }
    if (!availableSlots.includes(data.timeSlot)) {
      throw new BadRequestException(
        `Horário "${data.timeSlot}" não é válido para esta equipe. Horários disponíveis: ${availableSlots.join(', ')}`,
      );
    }

    // Verificar conflito: mesmo teamId + mesma data + mesmo timeSlot
    const hasConflict = await this.checkConflict(
      data.teamId,
      data.scheduledDate,
      data.timeSlot,
    );
    if (hasConflict) {
      throw new ConflictException(
        `Já existe um agendamento para esta equipe no horário ${data.timeSlot} nesta data`,
      );
    }

    const db = this.firebaseService.getFirestore();

    const scheduleRef = await db.collection('schedules').add({
      orderId: data.orderId,
      userId: data.userId,
      teamId: data.teamId,
      scheduledDate: admin.firestore.Timestamp.fromDate(data.scheduledDate),
      timeSlot: data.timeSlot,
      status: ScheduleStatus.PENDING,
      notes: '',
      peopleCount: data.peopleCount,
      services: data.services,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    this.logger.log(
      `Agendamento ${scheduleRef.id} criado para pedido ${data.orderId} (equipe: ${team.name}, horário: ${data.timeSlot})`,
    );
    return scheduleRef.id;
  }

  /**
   * Verificar se já existe agendamento ativo para a equipe naquele horário/data
   */
  async checkConflict(
    teamId: string,
    date: Date,
    timeSlot: string,
  ): Promise<boolean> {
    const db = this.firebaseService.getFirestore();

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const snapshot = await db
      .collection('schedules')
      .where('teamId', '==', teamId)
      .where(
        'scheduledDate',
        '>=',
        admin.firestore.Timestamp.fromDate(startOfDay),
      )
      .where(
        'scheduledDate',
        '<=',
        admin.firestore.Timestamp.fromDate(endOfDay),
      )
      .get();

    // Filtrar por timeSlot e status ativo (Firestore limita where compostos)
    return snapshot.docs.some((doc) => {
      const data = doc.data() as FirestoreScheduleData;
      return (
        data.timeSlot === timeSlot && data.status !== ScheduleStatus.CANCELLED
      );
    });
  }

  /**
   * Buscar agendamento por ID
   */
  async findOne(scheduleId: string): Promise<Schedule> {
    const db = this.firebaseService.getFirestore();
    const doc = await db.collection('schedules').doc(scheduleId).get();

    if (!doc.exists) {
      throw new NotFoundException('Agendamento não encontrado');
    }

    return this.mapDoc(doc);
  }

  /**
   * Buscar agendamentos do usuário
   */
  async findByUser(userId: string): Promise<Schedule[]> {
    const db = this.firebaseService.getFirestore();
    const snapshot = await db
      .collection('schedules')
      .where('userId', '==', userId)
      .orderBy('scheduledDate', 'asc')
      .get();

    return snapshot.docs.map((doc) => this.mapDoc(doc));
  }

  /**
   * Listar todos os agendamentos (admin/employee) com filtros opcionais
   */
  async findAll(filters?: {
    date?: string;
    teamId?: string;
  }): Promise<Schedule[]> {
    const db = this.firebaseService.getFirestore();
    let query: admin.firestore.Query = db.collection('schedules');

    if (filters?.teamId) {
      query = query.where('teamId', '==', filters.teamId);
    }

    query = query.orderBy('scheduledDate', 'asc');

    if (filters?.date) {
      const startOfDay = new Date(filters.date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(filters.date);
      endOfDay.setHours(23, 59, 59, 999);

      query = query
        .where(
          'scheduledDate',
          '>=',
          admin.firestore.Timestamp.fromDate(startOfDay),
        )
        .where(
          'scheduledDate',
          '<=',
          admin.firestore.Timestamp.fromDate(endOfDay),
        );
    }

    const snapshot = await query.limit(200).get();
    return snapshot.docs.map((doc) => this.mapDoc(doc));
  }

  /**
   * Verificar disponibilidade de uma data — retorna slots livres por equipe ativa
   */
  async checkAvailability(date: string): Promise<{
    date: string;
    teams: Array<{
      teamId: string;
      teamName: string;
      allSlots: string[];
      availableSlots: string[];
      occupiedSlots: string[];
    }>;
  }> {
    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      throw new BadRequestException('Data inválida');
    }

    // Buscar todas as equipes ativas
    const activeTeams = await this.teamsService.findActive();

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    // Buscar todos os agendamentos ativos nessa data
    const db = this.firebaseService.getFirestore();
    const snapshot = await db
      .collection('schedules')
      .where(
        'scheduledDate',
        '>=',
        admin.firestore.Timestamp.fromDate(startOfDay),
      )
      .where(
        'scheduledDate',
        '<=',
        admin.firestore.Timestamp.fromDate(endOfDay),
      )
      .get();

    const existingSchedules = snapshot.docs.map(
      (doc) => doc.data() as FirestoreScheduleData,
    );

    const teams = activeTeams.map((team) => {
      const allSlots = this.teamsService.getTimeSlotsForDate(team, parsedDate);

      // Slots já ocupados por esta equipe (não cancelados)
      const occupiedSlots = existingSchedules
        .filter(
          (s) => s.teamId === team.id && s.status !== ScheduleStatus.CANCELLED,
        )
        .map((s) => s.timeSlot);

      const availableSlots = allSlots.filter(
        (slot) => !occupiedSlots.includes(slot),
      );

      return {
        teamId: team.id,
        teamName: team.name,
        allSlots,
        availableSlots,
        occupiedSlots,
      };
    });

    return { date, teams };
  }

  /**
   * Confirmar agendamento (EMPLOYEE/ADMIN)
   */
  async confirm(scheduleId: string): Promise<void> {
    const schedule = await this.findOne(scheduleId);

    if (schedule.status !== ScheduleStatus.PENDING) {
      throw new BadRequestException(
        `Agendamento não pode ser confirmado (status atual: ${schedule.status})`,
      );
    }

    await this.updateStatus(scheduleId, ScheduleStatus.CONFIRMED);
    this.logger.log(`Agendamento ${scheduleId} confirmado`);
  }

  /**
   * Atualizar notas do agendamento
   */
  async updateNotes(scheduleId: string, notes: string): Promise<void> {
    const db = this.firebaseService.getFirestore();
    const ref = db.collection('schedules').doc(scheduleId);
    const doc = await ref.get();

    if (!doc.exists) {
      throw new NotFoundException('Agendamento não encontrado');
    }

    await ref.update({
      notes,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  /**
   * Cancelar agendamento
   */
  async cancel(scheduleId: string): Promise<void> {
    const schedule = await this.findOne(scheduleId);

    if (
      schedule.status === ScheduleStatus.COMPLETED ||
      schedule.status === ScheduleStatus.CANCELLED
    ) {
      throw new BadRequestException(
        `Agendamento não pode ser cancelado (status atual: ${schedule.status})`,
      );
    }

    await this.updateStatus(scheduleId, ScheduleStatus.CANCELLED);
    this.logger.log(`Agendamento ${scheduleId} cancelado`);
  }

  /**
   * Atualizar status do agendamento
   */
  async updateStatus(
    scheduleId: string,
    status: ScheduleStatus,
  ): Promise<void> {
    const db = this.firebaseService.getFirestore();

    await db.collection('schedules').doc(scheduleId).update({
      status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  private mapDoc(
    doc: admin.firestore.DocumentSnapshot<admin.firestore.DocumentData>,
  ): Schedule {
    const data = doc.data() as FirestoreScheduleData;
    return {
      id: doc.id,
      orderId: data.orderId,
      userId: data.userId,
      teamId: data.teamId,
      scheduledDate: data.scheduledDate.toDate(),
      timeSlot: data.timeSlot,
      status: data.status,
      notes: data.notes,
      peopleCount: data.peopleCount,
      services: data.services,
      createdAt: data.createdAt.toDate(),
      updatedAt: data.updatedAt.toDate(),
    };
  }
}
