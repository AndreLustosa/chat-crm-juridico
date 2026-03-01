import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class S3Service implements OnModuleInit {
  private readonly logger = new Logger(S3Service.name);
  private readonly storagePath: string;

  constructor() {
    this.storagePath = process.env.MEDIA_PATH || '/app/uploads';
  }

  async onModuleInit() {
    await fs.promises.mkdir(this.storagePath, { recursive: true });
    this.logger.log(`Media storage ready: ${this.storagePath}`);
  }

  async uploadBuffer(key: string, buffer: Buffer, mimeType: string) {
    const filePath = path.join(this.storagePath, key);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, buffer);
    this.logger.log(`Saved: ${key} (${buffer.length} bytes)`);
    return key;
  }
}
