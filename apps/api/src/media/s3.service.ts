import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Readable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';

const CONTENT_TYPES: Record<string, string> = {
  ogg: 'audio/ogg',
  webm: 'audio/webm',
  mp4: 'audio/mp4',
  m4a: 'audio/mp4',
  opus: 'audio/opus',
  mp3: 'audio/mpeg',
};

@Injectable()
export class MediaS3Service implements OnModuleInit {
  private readonly logger = new Logger(MediaS3Service.name);
  private readonly storagePath: string;

  constructor() {
    this.storagePath = process.env.MEDIA_PATH || '/app/uploads';
  }

  async onModuleInit() {
    await fs.promises.mkdir(this.storagePath, { recursive: true });
    this.logger.log(`Media storage ready: ${this.storagePath}`);
  }

  async uploadBuffer(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    const filePath = path.join(this.storagePath, key);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, buffer);
    this.logger.log(`Saved: ${key} (${buffer.length} bytes)`);
  }

  async getObjectStream(key: string): Promise<{
    stream: Readable;
    contentType: string;
    contentLength?: number;
  }> {
    const filePath = path.join(this.storagePath, key);
    const stat = await fs.promises.stat(filePath);
    const ext = path.extname(key).slice(1).toLowerCase();
    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
    const stream = fs.createReadStream(filePath);
    return { stream, contentType, contentLength: stat.size };
  }
}
