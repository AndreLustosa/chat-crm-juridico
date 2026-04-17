import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { promises as fs, createReadStream, existsSync } from 'fs';
import { Readable } from 'stream';
import * as path from 'path';

/**
 * Armazenamento de mídia no filesystem local da VPS.
 * Substitui MediaS3Service (MinIO) para novas mídias.
 *
 * Organização: {MEDIA_STORAGE_PATH}/{YYYY}/{MM}/{messageId}.{ext}
 * Permissões: diretórios 0700, arquivos 0600 (só o owner lê).
 */
@Injectable()
export class FileStorageService implements OnModuleInit {
  private readonly logger = new Logger(FileStorageService.name);
  private readonly basePath: string;

  constructor() {
    this.basePath = process.env.MEDIA_STORAGE_PATH || '/var/lib/crm-media';
  }

  async onModuleInit() {
    try {
      await fs.mkdir(this.basePath, { recursive: true, mode: 0o700 });
      this.logger.log(`[FS] Media storage inicializado em ${this.basePath}`);
    } catch (e: any) {
      this.logger.error(`[FS] Falha ao criar ${this.basePath}: ${e.message}`);
    }
  }

  /** Converte messageId + extensão em path relativo particionado por YYYY/MM */
  generatePath(messageId: string, ext: string): string {
    const now = new Date();
    const year = now.getUTCFullYear().toString();
    const month = (now.getUTCMonth() + 1).toString().padStart(2, '0');
    const cleanExt = ext.replace(/^\./, '').toLowerCase() || 'bin';
    return `${year}/${month}/${messageId}.${cleanExt}`;
  }

  /** Retorna o path absoluto (para Google Drive, etc) */
  getFullPath(relativePath: string): string {
    // Sanitiza para não permitir path traversal (../../)
    const normalized = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, '');
    return path.join(this.basePath, normalized);
  }

  /** Escreve buffer no filesystem. Cria dirs se necessário. */
  async write(relativePath: string, buffer: Buffer): Promise<void> {
    const fullPath = this.getFullPath(relativePath);
    const dir = path.dirname(fullPath);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.writeFile(fullPath, buffer, { mode: 0o600 });
  }

  /** Lê o arquivo inteiro como Buffer */
  async read(relativePath: string): Promise<Buffer> {
    return fs.readFile(this.getFullPath(relativePath));
  }

  /** Stream para servir áudio/vídeo com suporte a range requests */
  readStream(relativePath: string, range?: { start: number; end?: number }): Readable {
    const fullPath = this.getFullPath(relativePath);
    if (range) {
      return createReadStream(fullPath, { start: range.start, end: range.end });
    }
    return createReadStream(fullPath);
  }

  /** Verifica se o arquivo existe no disco */
  async exists(relativePath: string): Promise<boolean> {
    try {
      await fs.access(this.getFullPath(relativePath));
      return true;
    } catch {
      return false;
    }
  }

  /** Retorna o tamanho do arquivo em bytes (ou null se não existe) */
  async getSize(relativePath: string): Promise<number | null> {
    try {
      const stat = await fs.stat(this.getFullPath(relativePath));
      return stat.size;
    } catch {
      return null;
    }
  }

  /** Deleta o arquivo (idempotente — não falha se não existe) */
  async delete(relativePath: string): Promise<void> {
    try {
      await fs.unlink(this.getFullPath(relativePath));
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
    }
  }

  /** Health check — garante que o diretório base está escrevível */
  async healthCheck(): Promise<{ ok: boolean; basePath: string; writable: boolean }> {
    try {
      const testFile = path.join(this.basePath, `.healthcheck-${Date.now()}`);
      await fs.writeFile(testFile, '');
      await fs.unlink(testFile);
      return { ok: true, basePath: this.basePath, writable: true };
    } catch {
      return { ok: false, basePath: this.basePath, writable: false };
    }
  }
}
