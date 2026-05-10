import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
} from 'class-validator';

export class SaveOrganicSearchConfigDto {
  @IsString()
  siteUrl!: string;

  @IsString()
  @IsOptional()
  serviceAccountJson?: string;
}

export class CreateOrganicLandingPageDto {
  @IsString()
  url!: string;

  @IsString()
  title!: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  state?: string;

  @IsString()
  @IsOptional()
  practiceArea?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  targetKeywords?: string[];

  @IsString()
  @IsOptional()
  sitemapUrl?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateOrganicLandingPageDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  city?: string | null;

  @IsString()
  @IsOptional()
  state?: string | null;

  @IsString()
  @IsOptional()
  practiceArea?: string | null;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  targetKeywords?: string[];

  @IsString()
  @IsOptional()
  sitemapUrl?: string | null;

  @IsString()
  @IsOptional()
  notes?: string | null;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class SyncOrganicTrafficDto {
  @IsString()
  @IsOptional()
  startDate?: string;

  @IsString()
  @IsOptional()
  endDate?: string;

  @IsString()
  @IsOptional()
  pageId?: string;

  @IsBoolean()
  @IsOptional()
  inspect?: boolean;
}
