import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';

/**
 * Bloqueia endpoints de "IA interna" do modulo de Trafego quando a flag
 * `TRAFEGO_IA_INTERNA_ENABLED` esta desabilitada.
 *
 * Por que aqui (interceptor global em common/) e nao um decorator no
 * trafego.controller.ts: a Fase 0 da especificacao do MCP determinou
 * "zero arquivos modificados em apps/api/src/trafego/". Este interceptor
 * mora completamente fora do modulo de Trafego — ele apenas observa o
 * path da request e decide.
 *
 * Quando a flag esta `false`, todas as rotas listadas em
 * `BLOCKED_PATTERNS` retornam 503 com payload tipado:
 *   { error: 'ia_interna_desativada', message: '...' }
 *
 * O Claude (via Cowork) assume essa responsabilidade. A IA interna do CRM
 * fica como fallback dormente — pra reativar, basta setar
 * TRAFEGO_IA_INTERNA_ENABLED=true.
 *
 * Default da flag: `true` (mantem comportamento atual). O usuario opta-out
 * explicitamente em prod via env quando estiver pronto pra delegar tudo
 * pro Claude.
 *
 * Padroes bloqueados (regex sobre req.path):
 *   - /trafego/ai/*                          (decisions, policy, trigger, generate-rsa)
 *   - /trafego/chat/*                        (sessoes do chat IA interna)
 *   - /trafego/conversion-actions/ai-suggestions  (sugestoes via Claude API embutida)
 *   - /trafego/optimization/*                (heuristica embutida — opiniao do CRM)
 *
 * NAO bloqueia /trafego/recommendations — sao recomendacoes do PROPRIO
 * Google Ads, nao IA interna.
 */
@Injectable()
export class TrafegoIaInternaInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TrafegoIaInternaInterceptor.name);

  /**
   * Cada padrao eh avaliado com `RegExp.test(path)`. Strip-prefix do Traefik
   * remove `/api`, entao paths chegam aqui como `/trafego/...`.
   */
  private static readonly BLOCKED_PATTERNS: RegExp[] = [
    /^\/trafego\/ai(\/|$)/,
    /^\/trafego\/chat(\/|$)/,
    /^\/trafego\/conversion-actions\/ai-suggestions$/,
    /^\/trafego\/optimization(\/|$)/,
  ];

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // So aplica em HTTP — websocket/microservice context nao tem req.path util.
    if (context.getType() !== 'http') return next.handle();

    if (this.isIaInternaEnabled()) return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const path = req.path ?? req.url ?? '';

    if (!TrafegoIaInternaInterceptor.BLOCKED_PATTERNS.some((re) => re.test(path))) {
      return next.handle();
    }

    // Log resumido — nao polui demais e ajuda a confirmar que a flag esta agindo.
    this.logger.warn(
      `IA interna desativada — bloqueando ${req.method} ${path} (TRAFEGO_IA_INTERNA_ENABLED=false)`,
    );

    throw new HttpException(
      {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        error: 'ia_interna_desativada',
        message:
          'Recurso de IA interna do modulo de Trafego desativado. ' +
          'Use o Claude via Cowork (MCP traffic-mcp-server) para gerenciar trafego. ' +
          'Para reativar este endpoint, defina TRAFEGO_IA_INTERNA_ENABLED=true no servidor.',
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  /**
   * Lida com env var em cada request — admin pode trocar via redeploy/restart
   * sem recompile. String nao definida = enabled (default backward-compat).
   * Strings 'false', '0', 'no', 'off' = disabled.
   */
  private isIaInternaEnabled(): boolean {
    const raw = (process.env.TRAFEGO_IA_INTERNA_ENABLED ?? '').trim().toLowerCase();
    if (raw === '') return true;
    return !['false', '0', 'no', 'off'].includes(raw);
  }
}
