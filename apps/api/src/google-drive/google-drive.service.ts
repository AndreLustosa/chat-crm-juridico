import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { decryptValue, encryptValue, isSensitiveKey } from '../common/utils/crypto.util';
import { google, drive_v3, docs_v1 } from 'googleapis';

@Injectable()
export class GoogleDriveService {
  private readonly logger = new Logger(GoogleDriveService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════
  //  Helpers — Settings
  // ═══════════════════════════════════════════════════════════════

  private async getSetting(key: string): Promise<string | null> {
    const row = await this.prisma.globalSetting.findUnique({ where: { key } });
    if (!row?.value) return null;
    return decryptValue(row.value);
  }

  private async setSetting(key: string, value: string): Promise<void> {
    const finalValue = isSensitiveKey(key) ? encryptValue(value) : value;
    await this.prisma.globalSetting.upsert({
      where: { key },
      update: { value: finalValue },
      create: { key, value: finalValue },
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  Config — status da integração
  // ═══════════════════════════════════════════════════════════════

  async isConfigured(): Promise<boolean> {
    const rootFolder = await this.getSetting('GDRIVE_ROOT_FOLDER_ID');
    if (!rootFolder) return false;

    // OAuth2 é o método principal (funciona com arquivos)
    const hasOAuth = !!(await this.getSetting('GDRIVE_OAUTH_REFRESH_TOKEN'));
    // Service Account é o fallback (só pastas)
    const hasSA = !!(await this.getSetting('GDRIVE_SERVICE_ACCOUNT_B64'));

    return hasOAuth || hasSA;
  }

  async getConfig() {
    const b64 = await this.getSetting('GDRIVE_SERVICE_ACCOUNT_B64');
    const rootFolder = await this.getSetting('GDRIVE_ROOT_FOLDER_ID');
    const oauthClientId = await this.getSetting('GDRIVE_OAUTH_CLIENT_ID');
    const oauthRefreshToken = await this.getSetting('GDRIVE_OAUTH_REFRESH_TOKEN');
    const oauthUserEmail = await this.getSetting('GDRIVE_OAUTH_USER_EMAIL');

    return {
      configured: !!(rootFolder && (oauthRefreshToken || b64)),
      hasServiceAccount: !!b64,
      hasRootFolder: !!rootFolder,
      rootFolderId: rootFolder || null,
      hasOAuth: !!oauthRefreshToken,
      oauthConfigured: !!(oauthClientId),
      oauthConnected: !!oauthRefreshToken,
      oauthUserEmail: oauthUserEmail || null,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  OAuth2 — Fluxo de autorização (como o n8n faz)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Cria OAuth2Client com as credenciais armazenadas no banco.
   * O n8n usa exatamente esse padrão: OAuth2 Client ID/Secret + refresh token.
   */
  private async getOAuth2Client() {
    const clientId = await this.getSetting('GDRIVE_OAUTH_CLIENT_ID');
    const clientSecret = await this.getSetting('GDRIVE_OAUTH_CLIENT_SECRET');
    const redirectUri = await this.getSetting('GDRIVE_OAUTH_REDIRECT_URI');

    if (!clientId || !clientSecret) {
      throw new Error('OAuth2 não configurado: GDRIVE_OAUTH_CLIENT_ID e GDRIVE_OAUTH_CLIENT_SECRET são necessários');
    }

    // Redirect URI: usar a configurada, ou derivar do NEXT_PUBLIC_API_URL, ou fallback
    const defaultRedirectUri = process.env.NEXT_PUBLIC_API_URL
      ? `${process.env.NEXT_PUBLIC_API_URL}/google-drive/oauth/callback`
      : 'https://andrelustosaadvogados.com.br/api/google-drive/oauth/callback';

    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri || defaultRedirectUri,
    );

    // Se temos refresh token, definir credenciais
    const refreshToken = await this.getSetting('GDRIVE_OAUTH_REFRESH_TOKEN');
    if (refreshToken) {
      oauth2Client.setCredentials({ refresh_token: refreshToken });
    }

    return oauth2Client;
  }

  /**
   * Gera URL de autorização para o admin conectar sua conta Google.
   * Escopos idênticos aos que o n8n usa para Google Docs/Drive.
   */
  async getOAuthUrl(): Promise<string> {
    const oauth2Client = await this.getOAuth2Client();

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',       // Obter refresh_token
      prompt: 'consent',            // Forçar tela de consentimento (garante refresh_token)
      scope: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/documents',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
    });

    this.logger.log('URL de autorização OAuth2 gerada');
    return url;
  }

  /**
   * Troca o código de autorização pelo refresh_token e armazena no banco.
   * Este é o passo final do fluxo OAuth2 — após o redirect do Google.
   */
  async handleOAuthCallback(code: string): Promise<{ email: string }> {
    const oauth2Client = await this.getOAuth2Client();

    const { tokens } = await oauth2Client.getToken(code);
    this.logger.log('Tokens OAuth2 obtidos com sucesso');

    if (!tokens.refresh_token) {
      this.logger.warn('Google não retornou refresh_token. O usuário pode precisar revogar acesso e reconectar.');
      throw new Error('Nenhum refresh_token retornado. Vá em myaccount.google.com/permissions, remova o app, e tente novamente.');
    }

    // Salvar refresh token (criptografado)
    await this.setSetting('GDRIVE_OAUTH_REFRESH_TOKEN', tokens.refresh_token);

    // Buscar email do usuário autenticado
    oauth2Client.setCredentials(tokens);
    let email = 'desconhecido';
    try {
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client as any });
      const userInfo = await oauth2.userinfo.get();
      email = userInfo.data.email || 'desconhecido';
      await this.setSetting('GDRIVE_OAUTH_USER_EMAIL', email);
      this.logger.log(`OAuth2 conectado: ${email}`);
    } catch (err: any) {
      this.logger.warn(`Não foi possível obter email do usuário: ${err.message}`);
    }

    return { email };
  }

  /**
   * Desconecta OAuth2 — remove tokens armazenados.
   */
  async disconnectOAuth(): Promise<void> {
    // Tentar revogar token no Google
    try {
      const refreshToken = await this.getSetting('GDRIVE_OAUTH_REFRESH_TOKEN');
      if (refreshToken) {
        const oauth2Client = await this.getOAuth2Client();
        await oauth2Client.revokeToken(refreshToken);
        this.logger.log('Token OAuth2 revogado no Google');
      }
    } catch (err: any) {
      this.logger.warn(`Falha ao revogar token: ${err.message}`);
    }

    // Remover do banco
    await this.prisma.globalSetting.deleteMany({
      where: { key: { in: ['GDRIVE_OAUTH_REFRESH_TOKEN', 'GDRIVE_OAUTH_USER_EMAIL'] } },
    });

    this.logger.log('OAuth2 desconectado');
  }

  // ═══════════════════════════════════════════════════════════════
  //  Auth — escolhe OAuth2 (preferencial) ou Service Account
  // ═══════════════════════════════════════════════════════════════

  /**
   * Retorna autenticação para operações de ARQUIVO (criar docs, etc).
   * Prioridade: OAuth2 > Service Account.
   *
   * OAuth2 usa o storage do USUÁRIO real (funciona).
   * Service Account tem 0 bytes de storage (falha para arquivos desde Abr/2025).
   */
  private async getAuthForFiles(): Promise<any> {
    // 1. Tentar OAuth2 (funciona para arquivos porque usa storage do usuário)
    const refreshToken = await this.getSetting('GDRIVE_OAUTH_REFRESH_TOKEN');
    if (refreshToken) {
      this.logger.debug('Usando OAuth2 para autenticação (storage do usuário)');
      return this.getOAuth2Client();
    }

    // 2. Fallback: Service Account (pode falhar para criação de arquivos)
    this.logger.warn('OAuth2 não disponível. Usando Service Account (pode falhar para criação de arquivos).');
    return this.getServiceAccountAuth();
  }

  /**
   * Retorna auth do Service Account para operações de PASTA (sempre funciona).
   * Pastas não consomem storage, então Service Account funciona.
   */
  private async getServiceAccountAuth() {
    const b64 = await this.getSetting('GDRIVE_SERVICE_ACCOUNT_B64');
    if (!b64) throw new Error('Service Account não configurada: GDRIVE_SERVICE_ACCOUNT_B64 ausente');

    const credentialsJson = Buffer.from(b64, 'base64').toString('utf8');
    const creds = JSON.parse(credentialsJson);

    // IMPORTANTE: passar credenciais COMPLETAS (não só client_email + private_key)
    // A Docs API precisa de project_id, client_id, token_uri, etc.
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/documents',
      ],
    });

    return auth;
  }

  /**
   * Retorna melhor auth disponível (OAuth2 preferencial).
   */
  private async getAuth() {
    const refreshToken = await this.getSetting('GDRIVE_OAUTH_REFRESH_TOKEN');
    if (refreshToken) {
      return this.getOAuth2Client();
    }
    return this.getServiceAccountAuth();
  }

  private async getDriveClient(): Promise<drive_v3.Drive> {
    const auth = await this.getAuth() as any;
    return google.drive({ version: 'v3', auth });
  }

  private async getDocsClient(): Promise<docs_v1.Docs> {
    const auth = await this.getAuth() as any;
    return google.docs({ version: 'v1', auth });
  }

  /**
   * Drive client autenticado com OAuth2 (para criar arquivos).
   * Cai no Service Account se OAuth2 não disponível.
   */
  private async getDriveClientForFiles(): Promise<drive_v3.Drive> {
    const auth = await this.getAuthForFiles() as any;
    return google.drive({ version: 'v3', auth });
  }

  /**
   * Docs client autenticado com OAuth2.
   */
  private async getDocsClientForFiles(): Promise<docs_v1.Docs> {
    const auth = await this.getAuthForFiles() as any;
    return google.docs({ version: 'v1', auth });
  }

  // ═══════════════════════════════════════════════════════════════
  //  Pastas — Service Account funciona (pastas não usam storage)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Verifica se a pasta existe e é acessível pela auth atual.
   * Pastas criadas pelo Service Account podem não ser visíveis via OAuth2.
   */
  private async isFolderAccessible(folderId: string): Promise<boolean> {
    try {
      const drive = await this.getDriveClient();
      await drive.files.get({ fileId: folderId, fields: 'id' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Cria ou retorna a pasta do Lead no Google Drive.
   * Formato: "Nome do Lead (últimos 4 dígitos do ID)"
   *
   * Se a pasta salva no banco não for acessível (ex: criada por SA antigo),
   * recria a pasta com a autenticação atual.
   */
  async ensureLeadFolder(leadId: string, leadName: string): Promise<string> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { google_drive_folder_id: true },
    });

    // Se já tem folder_id, verificar se é acessível
    if (lead?.google_drive_folder_id) {
      const accessible = await this.isFolderAccessible(lead.google_drive_folder_id);
      if (accessible) return lead.google_drive_folder_id;
      this.logger.warn(`Pasta do lead ${leadId} (${lead.google_drive_folder_id}) não acessível. Recriando...`);
    }

    const rootFolder = await this.getSetting('GDRIVE_ROOT_FOLDER_ID');
    if (!rootFolder) throw new Error('GDRIVE_ROOT_FOLDER_ID não configurado');

    const drive = await this.getDriveClient();
    const suffix = leadId.slice(-4);
    const folderName = `${leadName} (${suffix})`;

    // Verificar se pasta já existe no Drive (acessível pela auth atual)
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
      this.logger.log(`Pasta do lead criada: ${folderName} (${folderId})`);
    }

    await this.prisma.lead.update({
      where: { id: leadId },
      data: { google_drive_folder_id: folderId },
    });

    return folderId;
  }

  /**
   * Cria ou retorna a subpasta do caso dentro da pasta do Lead.
   * Verifica acessibilidade da pasta (pode ter sido criada por SA antigo).
   */
  async ensureCaseFolder(
    caseId: string,
    leadId: string,
    label: string,
  ): Promise<string> {
    const legalCase = await this.prisma.legalCase.findUnique({
      where: { id: caseId },
      select: { google_drive_folder_id: true },
    });

    // Se já tem folder_id, verificar se é acessível
    if (legalCase?.google_drive_folder_id) {
      const accessible = await this.isFolderAccessible(legalCase.google_drive_folder_id);
      if (accessible) return legalCase.google_drive_folder_id;
      this.logger.warn(`Pasta do caso ${caseId} (${legalCase.google_drive_folder_id}) não acessível. Recriando...`);
    }

    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { name: true },
    });
    const leadFolderId = await this.ensureLeadFolder(leadId, lead?.name || 'Lead');

    const drive = await this.getDriveClient();

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
      this.logger.log(`Pasta do caso criada: ${label} (${folderId})`);
    }

    await this.prisma.legalCase.update({
      where: { id: caseId },
      data: { google_drive_folder_id: folderId },
    });

    return folderId;
  }

  // ═══════════════════════════════════════════════════════════════
  //  Google Docs — Criação via OAuth2 (storage do USUÁRIO)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Cria um Google Doc dentro da pasta especificada.
   *
   * Estratégia (idêntica ao n8n):
   * - Usa drive.files.create com mimeType Google Docs e conversão
   * - Autenticado via OAuth2 → arquivo pertence ao USUÁRIO (tem storage)
   * - Service Accounts falhavam com storageQuotaExceeded desde Abr/2025
   *   porque têm 0 bytes de storage
   *
   * Após criação, compartilha com "anyone with link" para embed funcionar.
   */
  async createDoc(
    title: string,
    folderId: string,
    initialHtml?: string,
  ): Promise<{ docId: string; docUrl: string }> {
    const drive = await this.getDriveClientForFiles();

    this.logger.log(`Criando Google Doc: "${title}" na pasta ${folderId}...`);

    // Criar doc via Drive API com conversão de HTML → Google Docs
    // Este é o mesmo método que o n8n usa internamente
    const { Readable } = await import('stream');
    const htmlContent = initialHtml || '<html><body><p></p></body></html>';

    const res = await drive.files.create({
      requestBody: {
        name: title,
        parents: [folderId],
        mimeType: 'application/vnd.google-apps.document',
      },
      media: {
        mimeType: 'text/html',
        body: Readable.from(htmlContent),
      },
      fields: 'id,webViewLink',
    });

    const docId = res.data.id!;
    const docUrl = res.data.webViewLink || `https://docs.google.com/document/d/${docId}/edit`;

    this.logger.log(`Google Doc criado: ${docId} - ${docUrl}`);

    // Compartilhar com "anyone with link" para iframe embed funcionar
    await this.shareDocPublicly(drive, docId);

    // Se estamos usando OAuth2, também compartilhar com o service account
    // para que operações de leitura/sync funcionem com ambas auths
    try {
      const b64 = await this.getSetting('GDRIVE_SERVICE_ACCOUNT_B64');
      if (b64) {
        const creds = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
        if (creds.client_email) {
          await drive.permissions.create({
            fileId: docId,
            requestBody: { type: 'user', role: 'writer', emailAddress: creds.client_email },
            sendNotificationEmail: false,
          });
          this.logger.debug(`Doc compartilhado com service account: ${creds.client_email}`);
        }
      }
    } catch (err: any) {
      this.logger.debug(`Não foi possível compartilhar com SA: ${err.message}`);
    }

    this.logger.log(`Google Doc finalizado: "${title}" (${docId})`);
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
      this.logger.warn(`Writer falhou: ${shareErr.message}. Tentando reader...`);
      try {
        await drive.permissions.create({
          fileId: docId,
          requestBody: { type: 'anyone', role: 'reader' },
        });
        this.logger.log(`Doc ${docId} compartilhado (anyone/reader - fallback)`);
      } catch (shareErr2: any) {
        this.logger.warn(`Compartilhamento falhou: ${shareErr2.message}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  Google Docs — Leitura, Exportação, Sync
  // ═══════════════════════════════════════════════════════════════

  /**
   * Lê o conteúdo de um Google Doc e retorna como texto.
   */
  async getDocContent(docId: string): Promise<string> {
    const docs = await this.getDocsClient();

    const doc = await docs.documents.get({ documentId: docId });
    const body = doc.data.body;
    if (!body?.content) return '';

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

  // ═══════════════════════════════════════════════════════════════
  //  Teste de Conexão
  // ═══════════════════════════════════════════════════════════════

  async testConnection(): Promise<{ ok: boolean; message: string; folderName?: string; details?: string[] }> {
    const details: string[] = [];
    try {
      const rootFolder = await this.getSetting('GDRIVE_ROOT_FOLDER_ID');
      if (!rootFolder) {
        return { ok: false, message: 'GDRIVE_ROOT_FOLDER_ID não configurado', details };
      }

      // Determinar método de autenticação em uso
      const hasOAuth = !!(await this.getSetting('GDRIVE_OAUTH_REFRESH_TOKEN'));
      const hasSA = !!(await this.getSetting('GDRIVE_SERVICE_ACCOUNT_B64'));

      if (hasOAuth) {
        details.push('Método de autenticação: OAuth2 (conta do usuário)');
      } else if (hasSA) {
        details.push('Método de autenticação: Service Account (limitado — sem criação de arquivos)');
      } else {
        return { ok: false, message: 'Nenhuma autenticação configurada (OAuth2 ou Service Account)', details };
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

      // 2. Testar criação de Google Doc
      details.push('Testando criação de Google Doc...');
      try {
        const driveForFiles = await this.getDriveClientForFiles();
        const { Readable } = await import('stream');

        const docRes = await driveForFiles.files.create({
          requestBody: {
            name: '_teste_conexao_deletar',
            parents: [rootFolder],
            mimeType: 'application/vnd.google-apps.document',
          },
          media: {
            mimeType: 'text/html',
            body: Readable.from('<html><body><p>Teste de conexão</p></body></html>'),
          },
          fields: 'id,webViewLink',
        });

        const testDocId = docRes.data.id!;
        details.push(`✓ Doc criado: ${testDocId}`);

        // 3. Testar compartilhamento
        details.push('Testando compartilhamento (anyone/writer)...');
        try {
          await driveForFiles.permissions.create({
            fileId: testDocId,
            requestBody: { type: 'anyone', role: 'writer' },
          });
          details.push('✓ Compartilhamento OK');
        } catch (shareErr: any) {
          details.push(`⚠ Compartilhamento falhou: ${shareErr.message}`);
        }

        // 4. Limpar
        try {
          await driveForFiles.files.delete({ fileId: testDocId });
          details.push('✓ Doc de teste excluído');
        } catch (delErr: any) {
          details.push(`⚠ Não foi possível excluir doc de teste: ${delErr.message}`);
        }
      } catch (createErr: any) {
        const errData = createErr?.response?.data?.error || createErr.message;
        const errMsg = typeof errData === 'string' ? errData : JSON.stringify(errData);
        details.push(`✗ Falha ao criar Doc: ${errMsg}`);

        if (errMsg.includes('storageQuota') && !hasOAuth) {
          details.push('');
          details.push('⚠ DIAGNÓSTICO: Service Accounts têm 0 bytes de storage desde Abr/2025.');
          details.push('⚠ Para criar arquivos, configure OAuth2 (mesma forma que o n8n funciona).');
          details.push('⚠ Vá em "Conectar com Google" acima para autorizar via OAuth2.');
        }

        return {
          ok: false,
          message: `Pasta raiz OK, mas falha ao criar Google Doc: ${errMsg}`,
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
      const errMsg = typeof errDetails === 'string' ? errDetails : JSON.stringify(errDetails);
      this.logger.error(`Teste de conexão falhou: ${errMsg}`);
      details.push(`✗ Erro: ${errMsg}`);
      return { ok: false, message: `Erro: ${errMsg}`, details };
    }
  }
}
