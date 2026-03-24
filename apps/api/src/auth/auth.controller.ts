import { Controller, Post, Body, UnauthorizedException, HttpCode, HttpStatus, Request } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignInDto } from './dto/sign-in.dto';
import { Public } from './decorators/public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(@Body() signInDto: SignInDto) {
    const user = await this.authService.validateUser(signInDto.email, signInDto.password);
    if (!user) {
      throw new UnauthorizedException('Credenciais inválidas');
    }
    return this.authService.login(user);
  }

  /** Gera um token JWT de longa duração (1 ano) para uso no MCP. */
  @HttpCode(HttpStatus.OK)
  @Post('mcp-token')
  async mcpToken(@Request() req: any) {
    return this.authService.generateMcpToken(req.user);
  }
}
