import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { decryptValue } from '../common/utils/crypto.util';
import { google, drive_v3, docs_v1 } from 'googleapis';

@Injectable()
export class GoogleDriveService {
  private readonly logger = new Logger(GoogleDriveService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Helpers ────────────────────────────────────────────────

  private async getSetting(key: string): Promise<string | null> {
    const row = await this.prisma.globalSetting.findUnique({ where: { key } });
    if (!row?.value) return null;
    return decryptValue(row.value);
  }

  /** Verifica se o Google Drive está configurado */
  async isConfigured(): Promise<boolean> {
    const b64 = await this.getSetting('GDRIVE_SERVICE_ACCOUNT_B64');
    const rootFolder = await this.getSetting('GDRIVE_ROOT_FOLDER_ID');
    return !!(b64 && rootFolder);
  }

  /** Retorna status da configuração */
  async getConfig() {
    const b64 = await this.getSetting('GDRIVE_SERVICE_ACCOUNT_B64');
    const rootFolder = await this.getSetting('GDRIVE_ROOT_FOLDER_ID');
    return {
      configured: !!(b64 && rootFolder),
      hasServiceAccount: !!b64,
      hasRootFolder: !!rootFolder,
      rootFolderId: rootFolder || null,
    };
  }

  /** Cria cliente autenticado do Google (Drive + Docs) */
  private async getAuth() {
    const b64 = await this.getSetting('GDRIVE_SERVICE_ACCOUNT_B64');
    if (!b64) throw new Error('Google Drive não configurado: GDRIVE_SERVICE_ACCOUNT_B64 ausente');

    const credentialsJson = Buffer.from(b64, 'base64').toString('utf8');
    const creds = JSON.parse(credentialsJson);

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: creds.client_email,
        private_key: creds.private_key,
      },
      scopes: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/documents',
      ],
    });

    return auth;
  }

  private async getDriveClient(): Promise<drive_v3.Drive> {
    const auth = await this.getAuth();
    return google.drive({ version: 'v3', auth });
  }

  private async getDocsClient(): Promise<docs_v1.Docs> {
    const auth = await this.getAuth();
    return google.docs({ version: 'v1', auth });
  }

  // ── Pastas ─────────────────────────────────────────────────

  /**
   * Cria ou retorna a pasta do Lead no Google Drive.
   * Formato: "Nome do Lead (últimos 4 dígitos do ID)"
   */
  async ensureLeadFolder(leadId: string, leadName: string): Promise<string> {
    // Verificar se já existe no banco
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { google_drive_folder_id: true },
    });
    if (lead?.google_drive_folder_id) return lead.google_drive_folder_id;

    const rootFolder = await this.getSetting('GDRIVE_ROOT_FOLDER_ID');
    if (!rootFolder) throw new Error('GDRIVE_ROOT_FOLDER_ID não configurado');

    const drive = await this.getDriveClient();
    const suffix = leadId.slice(-4);
    const folderName = `${leadName} (${suffix})`;

    // Verificar se pasta já existe no Drive (por nome)
    const existing = await drive.files.list({
      q: `name='${folderName.replace(/'/g, "\\'")}' and '${rootFolder}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id,name)',
      spaces: 'drive',
    });

    let folderId: string;
    if (existing.data.files?.length) {
      folderId = existing.data.files[0].id!;
    } else {
      const res = await drive.files.create({
        requestBody: {
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [rootFolder],
        },
        fields: 'id',
      });
      folderId = res.data.id!;
      this.logger.log(`Pasta do lead criada no Drive: ${folderName} (${folderId})`);
    }

    // Salvar no banco
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { google_drive_folder_id: folderId },
    });

    return folderId;
  }

  /**
   * Cria ou retorna a subpasta do caso dentro da pasta do Lead.
   * Formato: "Área Jurídica - Número do Caso"
   */
  async ensureCaseFolder(
    caseId: string,
    leadId: string,
    label: string,
  ): Promise<string> {
    // Verificar se já existe no banco
    const legalCase = await this.prisma.legalCase.findUnique({
      where: { id: caseId },
      select: { google_drive_folder_id: true },
    });
    if (legalCase?.google_drive_folder_id) return legalCase.google_drive_folder_id;

    // Garantir que a pasta do lead existe
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { name: true },
    });
    const leadFolderId = await this.ensureLeadFolder(leadId, lead?.name || 'Lead');

    const drive = await this.getDriveClient();

    // Verificar se subpasta já existe
    const existing = await drive.files.list({
      q: `name='${label.replace(/'/g, "\\'")}' and '${leadFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id,name)',
      spaces: 'drive',
    });

    let folderId: string;
    if (existing.data.files?.length) {
      folderId = existing.data.files[0].id!;
    } else {
      const res = await drive.files.create({
        requestBody: {
          name: label,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [leadFolderId],
        },
        fields: 'id',
      });
      folderId = res.data.id!;
      this.logger.log(`Pasta do caso criada no Drive: ${label} (${folderId})`);
    }

    // Salvar no banco
    await this.prisma.legalCase.update({
      where: { id: caseId },
      data: { google_drive_folder_id: folderId },
    });

    return folderId;
  }

  // ── Google Docs ────────────────────────────────────────────

  /**
   * Cria um Google Doc dentro da pasta especificada.
   *
   * Estratégia: usa a Docs API (documents.create) para criar o doc e
   * depois move para a pasta desejada via Drive API (files.update).
   * Isso evita o erro "storageQuotaExceeded" que ocorre quando se usa
   * drive.files.create com mimeType Google Doc em service accounts.
   *
   * Após criação, compartilha com "anyone with link" para que
   * o iframe embed funcione e os usuários do escritório possam editar.
   */
  async createDoc(
    title: string,
    folderId: string,
    initialHtml?: string,
  ): Promise<{ docId: string; docUrl: string }> {
    const docs = await this.getDocsClient();
    const drive = await this.getDriveClient();

    this.logger.log(`Criando Google Doc: "${title}" na pasta ${folderId}...`);

    // 1. Criar doc via Docs API (cria na raiz do service account)
    let docId: string;
    try {
      const docRes = await docs.documents.create({
        requestBody: { title },
      });
      docId = docRes.data.documentId!;
      this.logger.log(`Doc criado via Docs API: ${docId}`);
    } catch (docsErr: any) {
      const errDetails = docsErr?.response?.data?.error || docsErr.message;
      this.logger.error(`Erro ao criar via Docs API: ${JSON.stringify(errDetails)}`);

      // Fallback: tentar via Drive API (upload de conteúdo vazio com conversão)
      this.logger.log(`Tentando fallback via Drive API com media upload...`);
      try {
        const { Readable } = await import('stream');
        const driveRes = await drive.files.create({
          requestBody: {
            name: title,
            parents: [folderId],
            mimeType: 'application/vnd.google-apps.document',
          },
          media: {
            mimeType: 'text/html',
            body: Readable.from(initialHtml || '<html><body><p></p></body></html>'),
          },
          fields: 'id,webViewLink',
        });
        docId = driveRes.data.id!;
        const docUrl = driveRes.data.webViewLink || `https://docs.google.com/document/d/${docId}/edit`;
        this.logger.log(`Doc criado via Drive upload fallback: ${docId}`);

        // Compartilhar
        await this.shareDocPublicly(drive, docId);

        return { docId, docUrl };
      } catch (driveErr: any) {
        const drvDetails = driveErr?.response?.data?.error || driveErr.message;
        this.logger.error(`Fallback Drive API também falhou: ${JSON.stringify(drvDetails)}`);
        throw new Error(`Falha ao criar Google Doc: ${JSON.stringify(drvDetails)}`);
      }
    }

    // 2. Mover doc da raiz do service account para a pasta desejada
    try {
      const fileInfo = await drive.files.get({
        fileId: docId,
        fields: 'parents',
      });
      const previousParents = (fileInfo.data.parents || []).join(',');

      await drive.files.update({
        fileId: docId,
        addParents: folderId,
        removeParents: previousParents,
        fields: 'id,webViewLink',
      });
      this.logger.log(`Doc ${docId} movido para pasta ${folderId}`);
    } catch (moveErr: any) {
      this.logger.warn(`Não foi possível mover doc para pasta: ${moveErr.message}. Doc ficará na raiz.`);
    }

    const docUrl = `https://docs.google.com/document/d/${docId}/edit`;

    // 3. Compartilhar com "anyone with link"
    await this.shareDocPublicly(drive, docId);

    // 4. Se há conteúdo HTML inicial, inserir via Docs API
    if (initialHtml) {
      try {
        await this.insertHtmlContent(docId, initialHtml);
      } catch (contentErr: any) {
        this.logger.warn(`Doc criado mas falha ao inserir conteúdo: ${contentErr.message}`);
      }
    }

    this.logger.log(`Google Doc finalizado: "${title}" (${docId}) - URL: ${docUrl}`);
    return { docId, docUrl };
  }

  /**
   * Compartilha doc com "anyone with link" — necessário para iframe embed.
   */
  private async shareDocPublicly(drive: drive_v3.Drive, docId: string): Promise<void> {
    try {
      await drive.permissions.create({
        fileId: docId,
        requestBody: { type: 'anyone', role: 'writer' },
      });
      this.logger.log(`Doc ${docId} compartilhado (anyone/writer)`);
    } catch (shareErr: any) {
      this.logger.warn(`Não conseguiu writer: ${shareErr.message}. Tentando reader...`);
      try {
        await drive.permissions.create({
          fileId: docId,
          requestBody: { type: 'anyone', role: 'reader' },
        });
        this.logger.log(`Doc ${docId} compartilhado (anyone/reader - fallback)`);
      } catch (shareErr2: any) {
        this.logger.warn(`Falha ao compartilhar doc ${docId}: ${shareErr2.message}`);
      }
    }
  }

  /**
   * Insere conteúdo de texto no Google Doc.
   * Converte HTML básico para requests da Docs API.
   */
  private async insertHtmlContent(docId: string, html: string) {
    const docs = await this.getDocsClient();

    // Extrair texto puro do HTML (strip tags simples)
    const plainText = html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/h[1-6]>/gi, '\n\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();

    if (!plainText) return;

    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: { index: 1 },
              text: plainText,
            },
          },
        ],
      },
    });
  }

  /**
   * Lê o conteúdo de um Google Doc e retorna como texto.
   */
  async getDocContent(docId: string): Promise<string> {
    const docs = await this.getDocsClient();

    const doc = await docs.documents.get({ documentId: docId });
    const body = doc.data.body;
    if (!body?.content) return '';

    // Extrair texto de todos os elementos estruturais
    let text = '';
    for (const element of body.content) {
      if (element.paragraph) {
        for (const el of element.paragraph.elements || []) {
          if (el.textRun?.content) {
            text += el.textRun.content;
          }
        }
      }
    }

    return text.trim();
  }

  /**
   * Exporta Google Doc como PDF (retorna Buffer).
   */
  async exportAsPdf(docId: string): Promise<Buffer> {
    const drive = await this.getDriveClient();

    const res = await drive.files.export(
      { fileId: docId, mimeType: 'application/pdf' },
      { responseType: 'arraybuffer' },
    );

    return Buffer.from(res.data as ArrayBuffer);
  }

  /**
   * Compartilha arquivo/pasta com um email.
   */
  async shareWithEmail(
    fileId: string,
    email: string,
    role: 'reader' | 'writer' | 'commenter' = 'writer',
  ): Promise<void> {
    const drive = await this.getDriveClient();

    await drive.permissions.create({
      fileId,
      requestBody: {
        type: 'user',
        role,
        emailAddress: email,
      },
      sendNotificationEmail: false,
    });

    this.logger.log(`Compartilhado ${fileId} com ${email} (${role})`);
  }

  /**
   * Garante que uma pasta ou arquivo seja acessível por "anyone with link".
   * Útil quando o service account cria recursos que precisam ser visíveis no iframe.
   */
  private async ensureAnyoneAccess(fileId: string, role: 'reader' | 'writer' = 'writer'): Promise<void> {
    try {
      const drive = await this.getDriveClient();
      await drive.permissions.create({
        fileId,
        requestBody: { type: 'anyone', role },
      });
    } catch (err: any) {
      this.logger.warn(`Não foi possível definir acesso público para ${fileId}: ${err.message}`);
    }
  }

  // ── Teste de Conexão ───────────────────────────────────────

  /**
   * Testa a conexão com Google Drive: lê a pasta raiz e tenta criar/excluir um doc de teste.
   */
  async testConnection(): Promise<{ ok: boolean; message: string; folderName?: string; details?: string[] }> {
    const details: string[] = [];
    try {
      const rootFolder = await this.getSetting('GDRIVE_ROOT_FOLDER_ID');
      if (!rootFolder) {
        return { ok: false, message: 'GDRIVE_ROOT_FOLDER_ID não configurado', details };
      }

      const drive = await this.getDriveClient();

      // 1. Testar acesso à pasta raiz
      details.push('Testando acesso à pasta raiz...');
      const res = await drive.files.get({
        fileId: rootFolder,
        fields: 'id,name,mimeType',
      });

      if (res.data.mimeType !== 'application/vnd.google-apps.folder') {
        return { ok: false, message: 'O ID informado não é uma pasta do Google Drive', details };
      }
      details.push(`✓ Pasta raiz: ${res.data.name}`);

      // 2. Testar criação de Google Doc (via Docs API — mesmo método usado em produção)
      details.push('Testando criação de Google Doc (Docs API)...');
      try {
        const docs = await this.getDocsClient();
        const docRes = await docs.documents.create({
          requestBody: { title: '_teste_conexao_deletar' },
        });
        const testDocId = docRes.data.documentId;
        details.push(`✓ Doc criado via Docs API: ${testDocId}`);

        // Mover para pasta raiz
        details.push('Testando mover doc para pasta raiz...');
        try {
          const fileInfo = await drive.files.get({ fileId: testDocId!, fields: 'parents' });
          const prevParents = (fileInfo.data.parents || []).join(',');
          await drive.files.update({
            fileId: testDocId!,
            addParents: rootFolder,
            removeParents: prevParents,
          });
          details.push('✓ Doc movido para pasta raiz');
        } catch (moveErr: any) {
          details.push(`⚠ Mover falhou: ${moveErr.message}`);
        }

        // 3. Testar compartilhamento
        details.push('Testando compartilhamento (anyone/writer)...');
        try {
          await drive.permissions.create({
            fileId: testDocId!,
            requestBody: { type: 'anyone', role: 'writer' },
          });
          details.push('✓ Compartilhamento OK');
        } catch (shareErr: any) {
          details.push(`⚠ Compartilhamento falhou: ${shareErr.message}. Docs podem não ser visíveis no iframe.`);
        }

        // 4. Limpar — excluir doc de teste
        try {
          await drive.files.delete({ fileId: testDocId! });
          details.push('✓ Doc de teste excluído');
        } catch (delErr: any) {
          details.push(`⚠ Não foi possível excluir doc de teste: ${delErr.message}`);
        }
      } catch (createErr: any) {
        const errData = createErr?.response?.data?.error || createErr.message;
        details.push(`✗ Falha ao criar Doc: ${JSON.stringify(errData)}`);
        return {
          ok: false,
          message: `Pasta raiz OK, mas falha ao criar Google Doc: ${JSON.stringify(errData)}`,
          folderName: res.data.name || undefined,
          details,
        };
      }

      return {
        ok: true,
        message: `Conexão OK. Pasta raiz: ${res.data.name}. Criação de docs ✓. Compartilhamento ✓.`,
        folderName: res.data.name || undefined,
        details,
      };
    } catch (err: any) {
      const errDetails = err?.response?.data?.error || err.message;
      this.logger.error(`Teste de conexão Google Drive falhou: ${JSON.stringify(errDetails)}`);
      details.push(`✗ Erro: ${JSON.stringify(errDetails)}`);
      return { ok: false, message: `Erro: ${JSON.stringify(errDetails)}`, details };
    }
  }
}
