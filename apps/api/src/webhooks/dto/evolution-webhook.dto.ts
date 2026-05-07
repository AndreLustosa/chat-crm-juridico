import { IsDefined, IsObject, IsOptional, IsString } from 'class-validator';

/**
 * DTO de validacao do webhook da Evolution API.
 *
 * Substitui o `@Body() payload: any` que aceitava qualquer formato e gerava
 * 500 (NullPointerException) em payloads malformados. Com o DTO, o
 * ValidationPipe rejeita upfront com 400 limpo.
 *
 * NOTA — config local:
 *   O ValidationPipe global usa forbidNonWhitelisted=true (rejeita campos
 *   nao declarados). Evolution envia varios campos opcionais que mudam por
 *   evento (sender, fromMe, messageType, etc). O controller usa @UsePipes
 *   local pra desabilitar essa flag — validamos apenas os campos criticos
 *   (event, instance/instanceId, data) e deixamos o resto passar.
 */
export class EvolutionWebhookDto {
  /** Tipo do evento: messages.upsert, contacts.upsert, chats.update, etc. */
  @IsDefined({ message: 'event eh obrigatorio no webhook' })
  @IsString({ message: 'event deve ser string' })
  event!: string;

  /** Nome da instancia da Evolution. Pelo menos um de `instance` ou `instanceId` deve vir. */
  @IsOptional()
  @IsString()
  instance?: string;

  /** ID alternativo da instancia — algumas versoes da Evolution mandam esse em vez de `instance`. */
  @IsOptional()
  @IsString()
  instanceId?: string;

  /** Payload do evento. Estrutura interna varia por tipo, validacao profunda fica no service. */
  @IsDefined({ message: 'data eh obrigatorio no webhook' })
  @IsObject({ message: 'data deve ser objeto' })
  data!: Record<string, any>;

  /**
   * Garante que pelo menos um identificador de instancia veio no payload.
   * Chamado pelo controller apos validacao do DTO.
   */
  static hasInstance(dto: EvolutionWebhookDto): boolean {
    return !!(dto.instance || dto.instanceId);
  }
}
