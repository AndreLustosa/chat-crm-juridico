import { Controller, Get, Post, Patch, Delete, Param, Body, Request, UseGuards } from '@nestjs/common';
import { LeadHonorariosService } from './lead-honorarios.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { IsString, IsNumber, IsOptional, Min, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

class CreateLeadHonorarioDto {
  @IsString()
  type: string;

  @IsNumber()
  @Type(() => Number)
  @Min(0.01, { message: 'Valor deve ser maior que zero' })
  total_value: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  installment_count?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  success_percentage?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  entry_value?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

class UpdateLeadHonorarioDto {
  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0.01)
  total_value?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  installment_count?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  success_percentage?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  entry_value?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('leads/:leadId/honorarios-negociados')
export class LeadHonorariosController {
  constructor(private readonly service: LeadHonorariosService) {}

  @Get()
  findAll(@Param('leadId') leadId: string) {
    return this.service.findByLead(leadId);
  }

  @Post()
  create(
    @Param('leadId') leadId: string,
    @Body() body: CreateLeadHonorarioDto,
    @Request() req: any,
  ) {
    const tenantId = req.user?.tenant_id;
    return this.service.create(leadId, body, tenantId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: UpdateLeadHonorarioDto,
  ) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
