import { Module, Logger } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './jwt.strategy';

const jwtLogger = new Logger('AuthModule');

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      jwtLogger.error('FATAL: JWT_SECRET não definido em produção! Encerrando...');
      process.exit(1);
    }
    jwtLogger.warn(
      '⚠️  JWT_SECRET não definido! Usando fallback INSEGURO. Defina JWT_SECRET no .env para produção.',
    );
    return '__INSECURE_DEV_FALLBACK_CHANGE_ME__';
  }
  if (secret === 'troque_esta_secret' || secret === '__INSECURE_DEV_FALLBACK_CHANGE_ME__') {
    if (process.env.NODE_ENV === 'production') {
      jwtLogger.error('FATAL: JWT_SECRET está com valor padrão inseguro em produção! Encerrando...');
      process.exit(1);
    }
    jwtLogger.warn('⚠️  JWT_SECRET está com valor padrão inseguro! Troque para produção.');
  }
  return secret;
}

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: getJwtSecret(),
        signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN || '8h') as any },
      }),
    }),
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
})
export class AuthModule {}
