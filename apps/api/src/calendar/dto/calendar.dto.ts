import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsArray,
  IsIn,
  IsDateString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const EVENT_TYPES = ['CONSULTA', 'TAREFA', 'AUDIENCIA', 'PRAZO', 'OUTRO'] as const;
const EVENT_STATUSES = ['AGENDADO', 'CONFIRMADO', 'CONCLUIDO', 'CANCELADO', 'ADIADO'] as const;

// ─── Reminder sub-DTO ─────────────────────────────────

class ReminderDto {
  @IsNumber()
  minutes_before: number;

  @IsOptional()
  @IsString()
  channel?: string;
}

// ─── Events ───────────────────────────────────────────

export class CreateEventDto {
  @IsIn(EVENT_TYPES as unknown as string[])
  type: string;

  @IsString()
  title: string;

  @IsOptional() @IsString()
  description?: string;

  @IsString()
  start_at: string;

  @IsOptional() @IsString()
  end_at?: string;

  @IsOptional() @IsBoolean()
  all_day?: boolean;

  @IsOptional() @IsIn(EVENT_STATUSES as unknown as string[])
  status?: string;

  @IsOptional() @IsString()
  priority?: string;

  @IsOptional() @IsString()
  color?: string;

  @IsOptional() @IsString()
  location?: string;

  @IsOptional() @IsString()
  lead_id?: string;

  @IsOptional() @IsString()
  conversation_id?: string;

  @IsOptional() @IsString()
  legal_case_id?: string;

  @IsOptional() @IsString()
  assigned_user_id?: string;

  @IsOptional() @IsString()
  appointment_type_id?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReminderDto)
  reminders?: ReminderDto[];

  @IsOptional() @IsString()
  recurrence_rule?: string;

  @IsOptional() @IsString()
  recurrence_end?: string;

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  recurrence_days?: number[];
}

export class UpdateEventDto {
  @IsOptional() @IsString()
  title?: string;

  @IsOptional() @IsString()
  description?: string;

  @IsOptional() @IsDateString()
  start_at?: string;

  @IsOptional() @IsDateString()
  end_at?: string;

  @IsOptional() @IsBoolean()
  all_day?: boolean;

  @IsOptional() @IsIn(EVENT_STATUSES as unknown as string[])
  status?: string;

  @IsOptional() @IsString()
  priority?: string;

  @IsOptional() @IsString()
  color?: string;

  @IsOptional() @IsString()
  location?: string;

  @IsOptional() @IsIn(EVENT_TYPES as unknown as string[])
  type?: string;

  @IsOptional() @IsString()
  lead_id?: string;

  @IsOptional() @IsString()
  conversation_id?: string;

  @IsOptional() @IsString()
  legal_case_id?: string;

  @IsOptional() @IsString()
  assigned_user_id?: string;

  @IsOptional() @IsString()
  appointment_type_id?: string;
}

// ─── Appointment Types ────────────────────────────────

export class CreateAppointmentTypeDto {
  @IsString()
  name: string;

  @IsNumber()
  duration: number;

  @IsOptional() @IsString()
  color?: string;
}

export class UpdateAppointmentTypeDto {
  @IsOptional() @IsString()
  name?: string;

  @IsOptional() @IsNumber()
  duration?: number;

  @IsOptional() @IsString()
  color?: string;

  @IsOptional() @IsBoolean()
  active?: boolean;
}

// ─── Holidays ─────────────────────────────────────────

export class CreateHolidayDto {
  @IsString()
  date: string;

  @IsString()
  name: string;

  @IsOptional() @IsBoolean()
  recurring_yearly?: boolean;
}

export class UpdateHolidayDto {
  @IsOptional() @IsString()
  date?: string;

  @IsOptional() @IsString()
  name?: string;

  @IsOptional() @IsBoolean()
  recurring_yearly?: boolean;
}
