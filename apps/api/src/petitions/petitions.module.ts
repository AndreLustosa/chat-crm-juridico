import { Module } from '@nestjs/common';
import { PetitionsController } from './petitions.controller';
import { PetitionsService } from './petitions.service';

@Module({
  controllers: [PetitionsController],
  providers: [PetitionsService],
  exports: [PetitionsService],
})
export class PetitionsModule {}
