import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { createWriteStream, createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

@Injectable()
export class S3Service implements OnModuleInit {
  private readonly logger = new Logger(S3Service.name);
  private client: S3Client;
  private bucket = process.env.S3_BUCKET || 'chat-crm-media';

  constructor() {
    this.client = new S3Client({
      endpoint: process.env.S3_ENDPOINT || 'http://minio:9000',
      region: process.env.S3_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
        secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
      },
      forcePathStyle: true,
    });
  }

  async onModuleInit() {
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Bucket "${this.bucket}" criado`);
    } catch (e: any) {
      const code = e?.Code || e?.name || '';
      if (!code.includes('BucketAlready') && !code.includes('OwnedByYou')) {
        this.logger.warn(`Bucket init: ${e?.message}`);
      }
    }
  }

  async uploadBuffer(key: string, buffer: Buffer, mimeType: string) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    });
    await this.client.send(command);
    this.logger.log(`Uploaded: ${key}`);
    return key;
  }

  /** Baixa um objeto do S3/MinIO e retorna o buffer + contentType */
  async getObjectBuffer(
    key: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    const response = await this.client.send(command);
    const stream = response.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return {
      buffer: Buffer.concat(chunks),
      contentType: response.ContentType || 'application/octet-stream',
    };
  }

  /**
   * Baixa um objeto grande direto pro disco (stream). Essencial pra vídeos de
   * audiência — evita carregar 1GB+ em memória.
   */
  async downloadToFile(key: string, destPath: string): Promise<void> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    const response = await this.client.send(command);
    const body = response.Body as Readable;
    await pipeline(body, createWriteStream(destPath));
    this.logger.log(`Downloaded: ${key} -> ${destPath}`);
  }

  /**
   * Upload streaming (multipart). Body pode ser um ReadStream de arquivo.
   */
  async uploadFile(key: string, filePath: string, mimeType: string): Promise<void> {
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(filePath),
        ContentType: mimeType,
      },
      partSize: 20 * 1024 * 1024,
      queueSize: 4,
    });
    await upload.done();
    this.logger.log(`Uploaded (file): ${key}`);
  }
}
