import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';

@Injectable()
export class MediaS3Service implements OnModuleInit {
  private readonly logger = new Logger(MediaS3Service.name);
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

  async uploadBuffer(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    });
    await this.client.send(command);
    this.logger.log(`Uploaded: ${key}`);
  }

  async deleteObject(key: string): Promise<void> {
    const command = new DeleteObjectCommand({ Bucket: this.bucket, Key: key });
    await this.client.send(command);
    this.logger.log(`Deleted: ${key}`);
  }

  async getObjectStream(key: string, rangeStart?: number, rangeEnd?: number): Promise<{
    stream: Readable;
    contentType: string;
    contentLength?: number;
  }> {
    const input: any = { Bucket: this.bucket, Key: key };
    if (rangeStart !== undefined && rangeEnd !== undefined) {
      input.Range = `bytes=${rangeStart}-${rangeEnd}`;
    }
    const command = new GetObjectCommand(input);
    const response = await this.client.send(command);
    return {
      stream: response.Body as Readable,
      contentType: response.ContentType || 'application/octet-stream',
      contentLength: response.ContentLength,
    };
  }

  async getFileBuffer(key: string): Promise<Buffer | null> {
    try {
      const { stream } = await this.getObjectStream(key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  }
}
