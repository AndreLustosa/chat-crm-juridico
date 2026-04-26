import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Decorator pra extrair o cliente autenticado do request — populado pelo
 * ClientJwtAuthGuard. Use em handlers de rotas /portal/*.
 *
 * Exemplo:
 *   @Get('me')
 *   @UseGuards(ClientJwtAuthGuard)
 *   getMe(@CurrentClient() client: ClientUser) {
 *     return { name: client.name };
 *   }
 */
export interface ClientUser {
  id: string;
  name: string | null;
  email: string | null;
  phone: string;
  tenant_id: string | null;
  is_client: boolean;
}

export const CurrentClient = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ClientUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.client;
  },
);
