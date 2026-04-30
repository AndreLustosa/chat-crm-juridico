import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { TrafficOCIService, OCI_JOB, OCIUploadInput } from './trafego-oci.service';

@Injectable()
@Processor('trafego-oci', { concurrency: 2 })
export class TrafficOCIProcessor extends WorkerHost {
  private readonly logger = new Logger(TrafficOCIProcessor.name);

  constructor(private oci: TrafficOCIService) {
    super();
  }

  async process(job: Job<OCIUploadInput>): Promise<void> {
    if (job.name !== OCI_JOB) {
      this.logger.warn(`[oci-processor] job desconhecido: ${job.name}`);
      return;
    }
    await this.oci.processUpload(job.data.uploadId);
  }
}
