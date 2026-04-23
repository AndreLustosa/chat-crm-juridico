import { IsArray, IsInt, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class SpeakerLabelDto {
  @IsString()
  id!: string; // ex: "SPEAKER_00"

  @IsString()
  label!: string; // ex: "Juiz", "Advogado A"

  @IsOptional()
  @IsString()
  color?: string; // "#RRGGBB"
}

export class UpdateSpeakersDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SpeakerLabelDto)
  speakers!: SpeakerLabelDto[];
}

export class UpdateTranscriptionDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  min_speakers?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  max_speakers?: number;
}
