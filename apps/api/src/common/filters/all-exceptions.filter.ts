import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { Response, Request } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);
  private readonly auditLogger = new Logger('AccessAudit');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Se a resposta já foi enviada (ex: stream), não tenta responder de novo
    if (response.headersSent) return;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Erro interno do servidor';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exResponse = exception.getResponse();
      message =
        typeof exResponse === 'string'
          ? exResponse
          : (exResponse as any).message || exception.message;
    }

    // ─── Audit log: registra tentativas de acesso negado (403) ───────────
    if (status === HttpStatus.FORBIDDEN) {
      const user = (request as any).user;
      this.auditLogger.warn(
        `ACESSO_NEGADO | ` +
        `user=${user?.id ?? 'anon'} | ` +
        `role=${user?.role ?? '-'} | ` +
        `${request.method} ${request.url} | ` +
        `ip=${request.ip ?? request.headers['x-forwarded-for'] ?? '-'} | ` +
        `motivo="${message}"`,
      );
    }

    // Log apenas erros 5xx (não polui log com 4xx intencionais)
    if (status >= 500) {
      this.logger.error(
        `[${request.method} ${request.url}] ${status} — ${exception instanceof Error ? exception.stack : exception}`,
      );
    }

    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
