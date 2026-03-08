import { IsString, IsOptional, IsBoolean, IsNumber } from 'class-validator';

export class CreateSkillDto {
  @IsString()
  name: string;

  @IsString()
  area: string;

  @IsString()
  system_prompt: string;

  @IsOptional() @IsString()
  model?: string;

  @IsOptional() @IsNumber()
  max_tokens?: number;

  @IsOptional() @IsNumber()
  temperature?: number;

  @IsOptional() @IsString()
  handoff_signal?: string | null;

  @IsOptional() @IsBoolean()
  active?: boolean;

  @IsOptional() @IsNumber()
  order?: number;
}

export class UpdateSkillDto {
  @IsOptional() @IsString()
  name?: string;

  @IsOptional() @IsString()
  area?: string;

  @IsOptional() @IsString()
  system_prompt?: string;

  @IsOptional() @IsString()
  model?: string;

  @IsOptional() @IsNumber()
  max_tokens?: number;

  @IsOptional() @IsNumber()
  temperature?: number;

  @IsOptional() @IsString()
  handoff_signal?: string | null;

  @IsOptional() @IsBoolean()
  active?: boolean;

  @IsOptional() @IsNumber()
  order?: number;
}
