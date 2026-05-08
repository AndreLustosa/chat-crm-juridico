import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediaS3Service } from '../media/s3.service';
import { tenantOrDefault } from '../common/constants/tenant';
import { randomUUID } from 'crypto';
import { extname } from 'path';

const VALID_FOLDERS = [
  'CLIENTE',
  'PROVAS',
  'CONTRATOS',
  'PETICOES',
  'DECISOES',
  'PROCURACOES',
  'OUTROS',
] as const;

@Injectable()
export class CaseDocumentsService {
  private readonly logger = new Logger(CaseDocumentsService.name);

  constructor(
    private prisma: PrismaService,
    private s3: MediaS3Service,
  ) {}

  // ─── Helpers ────────────────────────────────────────────

  private async verifyCaseAccess(caseId: string, tenantId?: string) {
    const lc = await this.prisma.legalCase.findUnique({
      where: { id: caseId },
      select: { id: true, tenant_id: true },
    });
    if (!lc) throw new NotFoundException('Caso não encontrado');
    if (tenantId && lc.tenant_id && lc.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado a este recurso');
    }
    return lc;
  }

  private buildS3Key(caseId: string, originalName: string): string {
    const ext = extname(originalName) || '';
    return `case-docs/${caseId}/${randomUUID()}${ext}`;
  }

  // ─── CRUD ──────────────────────────────────────────────

  async findByCaseId(
    caseId: string,
    tenantId?: string,
    folder?: string,
  ) {
    await this.verifyCaseAccess(caseId, tenantId);

    const where: any = { legal_case_id: caseId, parent_id: null };
    if (folder && VALID_FOLDERS.includes(folder as any)) {
      where.folder = folder;
    }

    // Documentos "tradicionais" do caso (CaseDocument) + anexos de
    // diligencias (Task) que estao vinculadas a este caso. UNION na
    // aplicacao porque sao tabelas distintas com shapes proximos mas
    // nao identicos.
    //
    // Anexo de Task pode aparecer aqui se a task tem legal_case_id=caseId.
    // UI marca esses items com kind='task' pra mostrar badge especial
    // (ex: "via diligencia: Pegar comprovante de residencia"), mas a
    // experiencia de listar/baixar/deletar eh a mesma do CaseDocument.
    const taskAttachWhere: any = { task: { legal_case_id: caseId } };
    if (folder && VALID_FOLDERS.includes(folder as any)) {
      taskAttachWhere.folder = folder;
    }

    const [docs, taskAttachments] = await Promise.all([
      this.prisma.caseDocument.findMany({
        where,
        include: {
          uploaded_by: { select: { id: true, name: true } },
          _count: { select: { versions: true } },
        },
        orderBy: { created_at: 'desc' },
      }),
      (this.prisma as any).taskAttachment.findMany({
        where: taskAttachWhere,
        include: {
          uploaded_by: { select: { id: true, name: true } },
          task: { select: { id: true, title: true } },
        },
        orderBy: { created_at: 'desc' },
      }),
    ]);

    // Normaliza shape pra UI tratar igual; campos diferentes ficam
    // como undefined no shape oposto.
    const normalizedDocs = docs.map((d: any) => ({ ...d, kind: 'document' as const }));
    const normalizedAttach = taskAttachments.map((a: any) => ({
      id: a.id,
      kind: 'task_attachment' as const,
      // Espelha campos comuns pro frontend usar a mesma listagem
      legal_case_id: caseId,
      folder: a.folder,
      name: a.name,
      original_name: a.original_name,
      s3_key: a.s3_key,
      mime_type: a.mime_type,
      size: a.size,
      version: 1,
      description: a.description,
      created_at: a.created_at,
      uploaded_by: a.uploaded_by,
      uploaded_via_portal: false,
      _count: { versions: 0 },
      // Extra: link pra Task de origem (UI mostra "anexado em X")
      from_task: a.task ? { id: a.task.id, title: a.task.title } : null,
    }));

    return [...normalizedDocs, ...normalizedAttach]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  async upload(
    caseId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    userId: string,
    tenantId?: string,
    folder = 'OUTROS',
    description?: string,
  ) {
    await this.verifyCaseAccess(caseId, tenantId);

    const s3Key = this.buildS3Key(caseId, file.originalname);
    await this.s3.uploadBuffer(s3Key, file.buffer, file.mimetype);

    const doc = await this.prisma.caseDocument.create({
      data: {
        legal_case_id: caseId,
        uploaded_by_id: userId,
        tenant_id: tenantOrDefault(tenantId),
        folder: VALID_FOLDERS.includes(folder as any) ? folder : 'OUTROS',
        name: file.originalname,
        original_name: file.originalname,
        s3_key: s3Key,
        mime_type: file.mimetype,
        size: file.size,
        description: description || null,
      },
      include: {
        uploaded_by: { select: { id: true, name: true } },
      },
    });

    this.logger.log(`Documento uploaded: ${doc.id} -> ${s3Key}`);
    return doc;
  }

  async download(docId: string, tenantId?: string) {
    const doc = await this.prisma.caseDocument.findUnique({
      where: { id: docId },
      include: { legal_case: { select: { tenant_id: true } } },
    });
    if (!doc) throw new NotFoundException('Documento não encontrado');
    if (tenantId && doc.legal_case.tenant_id && doc.legal_case.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado');
    }

    const result = await this.s3.getObjectStream(doc.s3_key);
    return {
      ...result,
      fileName: doc.original_name,
      mimeType: doc.mime_type,
    };
  }

  async update(
    docId: string,
    data: { name?: string; folder?: string; description?: string },
    tenantId?: string,
  ) {
    const doc = await this.prisma.caseDocument.findUnique({
      where: { id: docId },
      include: { legal_case: { select: { tenant_id: true } } },
    });
    if (!doc) throw new NotFoundException('Documento não encontrado');
    if (tenantId && doc.legal_case.tenant_id && doc.legal_case.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado');
    }

    const updateData: any = {};
    if (data.name) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.folder && VALID_FOLDERS.includes(data.folder as any)) {
      updateData.folder = data.folder;
    }

    return this.prisma.caseDocument.update({
      where: { id: docId },
      data: updateData,
      include: {
        uploaded_by: { select: { id: true, name: true } },
      },
    });
  }

  async remove(docId: string, tenantId?: string) {
    const doc = await this.prisma.caseDocument.findUnique({
      where: { id: docId },
      include: { legal_case: { select: { tenant_id: true } } },
    });
    if (!doc) throw new NotFoundException('Documento não encontrado');
    if (tenantId && doc.legal_case.tenant_id && doc.legal_case.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado');
    }

    // Deletar do S3
    try {
      await this.s3.deleteObject(doc.s3_key);
    } catch (e) {
      this.logger.warn(`Falha ao deletar S3 key ${doc.s3_key}: ${e}`);
    }

    // Deletar versões do S3 também
    const versions = await this.prisma.caseDocument.findMany({
      where: { parent_id: docId },
      select: { id: true, s3_key: true },
    });
    for (const v of versions) {
      try {
        await this.s3.deleteObject(v.s3_key);
      } catch (e) {
        this.logger.warn(`Falha ao deletar versão S3 key ${v.s3_key}: ${e}`);
      }
    }

    await this.prisma.caseDocument.delete({ where: { id: docId } });
    this.logger.log(`Documento ${docId} removido`);
    return { deleted: true };
  }

  async uploadVersion(
    docId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    userId: string,
    tenantId?: string,
  ) {
    const parent = await this.prisma.caseDocument.findUnique({
      where: { id: docId },
      include: {
        legal_case: { select: { tenant_id: true } },
        _count: { select: { versions: true } },
      },
    });
    if (!parent) throw new NotFoundException('Documento original não encontrado');
    if (tenantId && parent.legal_case.tenant_id && parent.legal_case.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado');
    }

    const s3Key = this.buildS3Key(parent.legal_case_id, file.originalname);
    await this.s3.uploadBuffer(s3Key, file.buffer, file.mimetype);

    const newVersion = parent._count.versions + 2; // parent é v1, versões filhas começam em v2

    const doc = await this.prisma.caseDocument.create({
      data: {
        legal_case_id: parent.legal_case_id,
        uploaded_by_id: userId,
        tenant_id: parent.tenant_id,
        folder: parent.folder,
        name: parent.name,
        original_name: file.originalname,
        s3_key: s3Key,
        mime_type: file.mimetype,
        size: file.size,
        version: newVersion,
        parent_id: docId,
      },
      include: {
        uploaded_by: { select: { id: true, name: true } },
      },
    });

    this.logger.log(`Nova versão (v${newVersion}) do doc ${docId}: ${doc.id}`);
    return doc;
  }
}
