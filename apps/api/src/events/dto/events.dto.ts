import { IsString, IsIn, IsOptional, IsUUID, IsDateString, MaxLength, IsNumber, Min, Max, IsInt } from 'class-validator';

// Bug fix 2026-05-10 (PR3 medio #4): endpoints /events/* aceitavam Body() body: any.
// Frontend podia mandar id vazio, type invalido, new_date "abc" sem 400 imediato —
// erro propagava ate o service e gerava stack trace genenrico. Agora cada
// endpoint tem DTO com validators explicitos.

const EVENT_TARGET_TYPES = ['CALENDAR', 'TASK', 'DEADLINE'] as const;

export class CompleteEventDto {
  @IsIn(EVENT_TARGET_TYPES as any)
  type: 'CALENDAR' | 'TASK' | 'DEADLINE';

  @IsUUID()
  id: string;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}

export class CancelEventDto {
  @IsIn(EVENT_TARGET_TYPES as any)
  type: 'CALENDAR' | 'TASK' | 'DEADLINE';

  @IsUUID()
  id: string;

  @IsOptional() @IsString() @MaxLength(2000)
  reason?: string;
}

export class PostponeEventDto {
  @IsIn(EVENT_TARGET_TYPES as any)
  type: 'CALENDAR' | 'TASK' | 'DEADLINE';

  @IsUUID()
  id: string;

  @IsDateString()
  new_date: string;

  @IsOptional() @IsString() @MaxLength(2000)
  reason?: string;
}

export class CompleteHearingDto {
  @IsUUID()
  id: string;

  @IsString() @MaxLength(2000)
  result: string;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;

  @IsOptional() @IsDateString()
  deadline_date?: string;

  @IsOptional() @IsString() @MaxLength(300)
  deadline_title?: string;

  // Honorarios — guardrails contra valores absurdos (negativos, > 100M)
  @IsOptional() @IsNumber() @Min(0) @Max(100_000_000)
  acordo_honorario_value?: number;

  @IsOptional() @IsInt() @Min(1) @Max(120)
  acordo_honorario_parcelas?: number;

  @IsOptional() @IsNumber() @Min(0) @Max(100_000_000)
  contratual_honorario_value?: number;

  @IsOptional() @IsInt() @Min(1) @Max(120)
  contratual_honorario_parcelas?: number;
}

export class ReopenEventDto {
  @IsIn(EVENT_TARGET_TYPES as any)
  type: 'CALENDAR' | 'TASK' | 'DEADLINE';

  @IsUUID()
  id: string;
}
