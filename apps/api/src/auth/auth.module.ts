import { Module, Logger } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './jwt.strategy';
import { getJwtSecret } from '../common/utils/jwt-secret.util';

const jwtLogger = new Logger('AuthModule');

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.registerAsync({
      useFactory: () => {
        const expiresIn = process.env.JWT_EXPIRES_IN || '30d';
        jwtLogger.log(`JWT_EXPIRES_IN = ${expiresIn}`);
        return {
          secret: getJwtSecret(),
          signOptions: { expiresIn: expiresIn as any },
        };
      },
    }),
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
})
export class AuthModule {}
