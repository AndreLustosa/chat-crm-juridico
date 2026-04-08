import { Module } from '@nestjs/common';
import { GoogleDriveController } from './google-drive.controller';
import { GoogleDriveService } from './google-drive.service';
import { GoogleDriveCleanupCron } from './google-drive-cleanup.cron';

@Module({
  controllers: [GoogleDriveController],
  providers: [GoogleDriveService, GoogleDriveCleanupCron],
  exports: [GoogleDriveService],
})
export class GoogleDriveModule {}
