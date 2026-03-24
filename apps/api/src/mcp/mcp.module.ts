import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { McpController } from './mcp.controller';
import { McpToolsService } from './mcp-tools.service';
import { LeadsModule } from '../leads/leads.module';
import { LegalCasesModule } from '../legal-cases/legal-cases.module';
import { CaseDocumentsModule } from '../case-documents/case-documents.module';
import { HonorariosModule } from '../honorarios/honorarios.module';

@Module({
  imports: [
    JwtModule.register({ secret: process.env.JWT_SECRET || 'fallback-secret' }),
    LeadsModule,
    LegalCasesModule,
    CaseDocumentsModule,
    HonorariosModule,
  ],
  controllers: [McpController],
  providers: [McpToolsService],
})
export class McpModule {}
