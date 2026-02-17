import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TeamsService } from './teams.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';

@ApiTags('teams')
@ApiBearerAuth()
@Controller('teams')
export class TeamsController {
  constructor(private teamsService: TeamsService) {}

  @Post()
  @ApiOperation({ summary: 'Criar equipe' })
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async create(@Body() dto: CreateTeamDto) {
    const teamId = await this.teamsService.create(dto);
    return { success: true, teamId };
  }

  @Get()
  @ApiOperation({ summary: 'Listar todas as equipes' })
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.EMPLOYEE, UserRole.ADMIN)
  async findAll() {
    return this.teamsService.findAll();
  }

  /**
   * Equipes ativas (rota publica - usada no checkout)
   */
  @Get('active')
  @ApiOperation({ summary: 'Listar equipes ativas' })
  async findActive() {
    return this.teamsService.findActive();
  }

  /**
   * Slots de uma equipe para uma data (rota publica)
   */
  @Get(':id/slots')
  @ApiOperation({ summary: 'Horarios disponiveis de uma equipe para uma data' })
  async getSlots(@Param('id') id: string, @Query('date') date: string) {
    if (!date) {
      throw new BadRequestException('Parâmetro "date" é obrigatório');
    }

    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      throw new BadRequestException('Data inválida');
    }

    const team = await this.teamsService.findOne(id);
    const slots = this.teamsService.getTimeSlotsForDate(team, parsedDate);

    return {
      teamId: id,
      teamName: team.name,
      isActive: team.isActive,
      date,
      slots,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar equipe por ID' })
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.EMPLOYEE, UserRole.ADMIN)
  async findOne(@Param('id') id: string) {
    return this.teamsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar equipe' })
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async update(@Param('id') id: string, @Body() dto: UpdateTeamDto) {
    await this.teamsService.update(id, dto);
    return { success: true, message: 'Equipe atualizada' };
  }
}
