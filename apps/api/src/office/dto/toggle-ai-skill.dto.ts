import { IsBoolean } from 'class-validator';

/**
 * Liga/desliga uma área de atendimento (skill GLOBAL) para o escritório.
 * A skill em si é da plataforma; aqui só gravamos o opt-out por tenant.
 */
export class ToggleAiSkillDto {
  @IsBoolean()
  enabled!: boolean;
}
