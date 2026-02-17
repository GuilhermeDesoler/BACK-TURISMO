import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SchedulesService } from './schedules.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import type { User } from '../common/interfaces/user.interface';
import { UpdateScheduleNotesDto } from './dto/update-schedule-notes.dto';

@ApiTags('schedules')
@ApiBearerAuth()
@Controller('schedules')
export class SchedulesController {
  constructor(private schedulesService: SchedulesService) {}

  /**
   * Verificar disponibilidade (rota publica)
   */
  @Get('availability')
  @ApiOperation({ summary: 'Verificar disponibilidade de agendamento' })
  async checkAvailability(@Query('date') date: string) {
    return this.schedulesService.checkAvailability(date);
  }

  /**
   * Meus agendamentos (cliente)
   */
  @Get('my')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Listar meus agendamentos' })
  async findMy(@CurrentUser() user: User) {
    return this.schedulesService.findByUser(user.uid);
  }

  /**
   * Listar todos os agendamentos (admin/employee)
   */
  @Get()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.EMPLOYEE, UserRole.ADMIN)
  @ApiOperation({ summary: 'Listar todos os agendamentos' })
  async findAll(
    @Query('date') date?: string,
    @Query('teamId') teamId?: string,
  ) {
    return this.schedulesService.findAll({ date, teamId });
  }

  /**
   * Buscar agendamento por ID
   */
  @Get(':id')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Buscar agendamento por ID' })
  async findOne(@Param('id') id: string) {
    return this.schedulesService.findOne(id);
  }

  /**
   * Confirmar agendamento (employee/admin)
   */
  @Patch(':id/confirm')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.EMPLOYEE, UserRole.ADMIN)
  @ApiOperation({ summary: 'Confirmar agendamento' })
  async confirm(@Param('id') id: string) {
    await this.schedulesService.confirm(id);
    return { success: true, message: 'Agendamento confirmado' };
  }

  /**
   * Adicionar notas ao agendamento (employee/admin)
   */
  @Patch(':id/notes')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.EMPLOYEE, UserRole.ADMIN)
  @ApiOperation({ summary: 'Atualizar notas do agendamento' })
  async updateNotes(
    @Param('id') id: string,
    @Body() dto: UpdateScheduleNotesDto,
  ) {
    await this.schedulesService.updateNotes(id, dto.notes);
    return { success: true, message: 'Notas atualizadas' };
  }

  /**
   * Cancelar agendamento
   */
  @Patch(':id/cancel')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Cancelar agendamento' })
  async cancel(@Param('id') id: string) {
    await this.schedulesService.cancel(id);
    return { success: true, message: 'Agendamento cancelado' };
  }
}
