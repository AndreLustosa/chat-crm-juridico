import { Module } from '@nestjs/common';
import { InviteController } from './invite.controller';
import { InviteService } from './invite.service';

/** Convite de novo escritorio (rotas publicas de validar/resgatar). */
@Module({
  controllers: [InviteController],
  providers: [InviteService],
})
export class InviteModule {}
