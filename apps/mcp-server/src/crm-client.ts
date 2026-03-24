/**
 * Cliente HTTP para a API REST do CRM Jurídico.
 * Autentica via JWT (email + senha) e faz refresh automático em caso de 401.
 */

interface LoginResponse {
  access_token: string;
}

export class CrmClient {
  private readonly baseUrl: string;
  private readonly email: string;
  private readonly password: string;
  private token: string | null;

  constructor() {
    this.baseUrl = (process.env.CRM_BASE_URL ?? 'http://localhost:3005').replace(/\/$/, '');
    this.email = process.env.CRM_EMAIL ?? '';
    this.password = process.env.CRM_PASSWORD ?? '';
    // Permite passar um JWT pré-gerado via CRM_JWT_TOKEN (opcional)
    this.token = process.env.CRM_JWT_TOKEN ?? null;
  }

  private async login(): Promise<void> {
    if (!this.email || !this.password) {
      throw new Error(
        'Variáveis de ambiente CRM_EMAIL e CRM_PASSWORD são obrigatórias (ou forneça CRM_JWT_TOKEN).',
      );
    }
    const res = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: this.email, password: this.password }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Falha no login CRM (${res.status}): ${text}`);
    }
    const data = (await res.json()) as LoginResponse;
    this.token = data.access_token;
  }

  async request<T = unknown>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    if (!this.token) await this.login();

    let url = `${this.baseUrl}${path}`;
    if (params) {
      const qs = Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
      if (qs) url += `?${qs}`;
    }

    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    // Token expirado — faz login novamente uma vez
    if (res.status === 401) {
      this.token = null;
      await this.login();
      return this.request<T>(method, path, body, params);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Erro na API CRM ${res.status} ${method} ${path}: ${text}`);
    }

    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      return res.json() as Promise<T>;
    }
    return res.text() as unknown as T;
  }

  // ─── Clientes (Leads) ───────────────────────────────────────

  getCliente(id: string) {
    return this.request('GET', `/leads/${id}`);
  }

  listarClientes(params?: {
    page?: number;
    limit?: number;
    search?: string;
    stage?: string;
    inboxId?: string;
  }) {
    return this.request('GET', '/leads', undefined, params as Record<string, string | number | boolean | undefined>);
  }

  criarCliente(data: {
    name: string;
    phone: string;
    email?: string;
    inbox_id?: string;
  }) {
    return this.request('POST', '/leads', data as Record<string, unknown>);
  }

  atualizarCliente(id: string, data: Record<string, unknown>) {
    return this.request('PATCH', `/leads/${id}`, data);
  }

  // ─── Processos (Legal Cases) ─────────────────────────────────

  getProcesso(id: string) {
    return this.request('GET', `/legal-cases/${id}`);
  }

  listarProcessos(params?: {
    leadId?: string;
    caseNumber?: string;
    stage?: string;
    archived?: boolean;
    page?: number;
    limit?: number;
  }) {
    return this.request('GET', '/legal-cases', undefined, params as Record<string, string | number | boolean | undefined>);
  }

  atualizarStageProcesso(id: string, stage: string) {
    return this.request('PATCH', `/legal-cases/${id}/stage`, { stage });
  }

  criarProcesso(data: {
    lead_id: string;
    legal_area?: string;
    action_type?: string;
    claim_value?: number;
    opposing_party?: string;
    notes?: string;
  }) {
    return this.request('POST', '/legal-cases', data as Record<string, unknown>);
  }

  // ─── Documentos (Case Documents) ─────────────────────────────

  listarDocumentos(caseId: string) {
    return this.request('GET', `/case-documents/${caseId}`);
  }

  atualizarDocumento(docId: string, data: Record<string, unknown>) {
    return this.request('PATCH', `/case-documents/${docId}`, data);
  }

  // ─── Honorários ──────────────────────────────────────────────

  getHonorarios(caseId: string) {
    return this.request('GET', `/honorarios/case/${caseId}`);
  }

  marcarPagamentoPago(paymentId: string, paidAt?: string) {
    return this.request('PATCH', `/honorarios/payments/${paymentId}/mark-paid`, paidAt ? { paid_at: paidAt } : {});
  }

  adicionarPagamento(honorarioId: string, data: Record<string, unknown>) {
    return this.request('POST', `/honorarios/${honorarioId}/payments`, data);
  }
}
