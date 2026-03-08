import { Module } from '@nestjs/common';
import { CaseDocumentsController } from './case-documents.controller';
import { CaseDocumentsService } from './case-documents.service';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [MediaModule],
  controllers: [CaseDocumentsController],
  providers: [CaseDocumentsService],
  exports: [CaseDocumentsService],
})
export class CaseDocumentsModule {}
