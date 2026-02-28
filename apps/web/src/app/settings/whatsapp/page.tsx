'use client';

import { useState, useEffect } from 'react';
import { 
  MessageSquare, 
  Plus, 
  RefreshCw, 
  Trash2, 
  ExternalLink, 
  CheckCircle2, 
  AlertCircle,
  HelpCircle,
  QrCode,
  Zap,
  Info
} from 'lucide-react';
import api from '@/lib/api';

interface Instance {
  instanceName: string;
  status: string;
  owner?: string;
  profileName?: string;
  profilePictureUrl?: string;
}

export default function WhatsappIntegrationPage() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'guide' | 'instances'>('instances');
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [selectedInstance, setSelectedInstance] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [newInstanceName, setNewInstanceName] = useState('');
  const [creating, setCreating] = useState(false);
  
  // Configurações Globais
  const [apiUrl, setApiUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [apiStatus, setApiStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [isEditingConfig, setIsEditingConfig] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  const checkApiHealth = async () => {
    try {
      const res = await api.get('/settings/whatsapp-config/health');
      setApiStatus(res.data.status === 'online' ? 'online' : 'offline');
    } catch (error) {
      setApiStatus('offline');
    }
  };

  const fetchInstances = async () => {
    setLoading(true);
    try {
      // 1. Carrega as configs primeiro (Sempre deve funcionar se o nosso back estiver online)
      try {
        const configRes = await api.get('/settings/whatsapp-config');
        const config = configRes.data;
        
        setApiUrl(config.apiUrl || 'api.andrelustosaadvogados.com.br');
        setApiKey(config.apiKey || '');
        setWebhookUrl(config.webhookUrl || 'https://atendimento.andrelustosaadvogados.com.br/api/webhooks/evolution');
        
        // Checa a saúde da API em paralelo
        checkApiHealth();
      } catch (err) {
        console.error('Erro ao carregar configurações de API:', err);
        // Fallback local se o back estiver incomunicável (improvável mas seguro)
        if (!apiUrl) setApiUrl('api.andrelustosaadvogados.com.br');
        if (!webhookUrl) setWebhookUrl('https://atendimento.andrelustosaadvogados.com.br/api/webhooks/evolution');
      }
      // 2. Tenta buscar instâncias (Pode falhar se a URL for inválida)
      try {
        const res = await api.get('/whatsapp/instances');
        setInstances(Array.isArray(res.data) ? res.data : (res.data?.data || []));
      } catch (err) {
        console.error('Erro ao carregar instâncias (URL possivelmente inválida):', err);
        setInstances([]);
        setApiStatus('offline');
      }
      
    } catch (error) {
      console.error('Erro geral no fetchInstances:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInstances();
  }, []);

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      await api.post('/settings/whatsapp-config', { apiUrl, apiKey, webhookUrl });
      setIsEditingConfig(false);
      alert('Configurações atualizadas com sucesso!');
      fetchInstances(); // Isso já chama o checkApiHealth
    } catch (error) {
      console.error('Erro ao salvar configurações:', error);
      alert('Erro ao salvar. Verifique se você é um administrador.');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleCreateInstance = async () => {
    if (!newInstanceName.trim()) return;
    setCreating(true);
    try {
      await api.post('/whatsapp/instances', { name: newInstanceName });
      setNewInstanceName('');
      await fetchInstances();
      // Após criar, abre o modal de conexão para a nova instância
      handleOpenConnect(newInstanceName);
    } catch (error) {
      console.error('Erro ao criar instância:', error);
      alert('Erro ao criar instância. Verifique se o nome já existe.');
    } finally {
      setCreating(false);
    }
  };

  const handleOpenConnect = async (name: string) => {
    setSelectedInstance(name);
    setShowConnectModal(true);
    setQrCode(null);
    try {
      const res = await api.get(`/whatsapp/instances/${name}/connect`);
      if (res.data?.base64) {
        setQrCode(res.data.base64);
      }
    } catch (error) {
      console.error('Erro ao buscar QR Code:', error);
    }
  };

  const handleDeleteInstance = async (name: string) => {
    if (!confirm(`Tem certeza que deseja excluir a instância "${name}"? Esta ação é irreversível.`)) return;
    try {
      await api.delete(`/whatsapp/instances/${name}`);
      await fetchInstances();
    } catch (error) {
      console.error('Erro ao excluir instância:', error);
    }
  };

  const StepCard = ({ number, title, description, badge }: any) => (
    <div className="bg-card border border-border rounded-2xl p-6 relative overflow-hidden group hover:border-primary/30 transition-all">
      <div className="absolute -right-4 -top-4 w-24 h-24 bg-primary/5 rounded-full blur-2xl group-hover:bg-primary/10 transition-all"></div>
      <div className="flex items-start gap-4 mb-4">
        <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0">
          {number}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-bold text-foreground text-lg">{title}</h4>
            {badge && <span className="px-2 py-0.5 rounded-full bg-primary/20 text-primary text-[10px] font-bold uppercase">{badge}</span>}
          </div>
          <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      {/* Header */}
      <header className="p-8 border-b border-border bg-card/30 backdrop-blur-md">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
                <Zap size={24} />
              </div>
              <h1 className="text-3xl font-bold text-foreground tracking-tight">Integração WhatsApp</h1>
            </div>
            <p className="text-muted-foreground">Gerencie suas conexões com a Evolution API e conecte múltiplos números.</p>
          </div>
          
          <div className="flex bg-muted p-1 rounded-xl shrink-0">
            <button 
              onClick={() => setActiveTab('instances')}
              className={`px-6 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'instances' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Suas Instâncias
            </button>
            <button 
              onClick={() => setActiveTab('guide')}
              className={`px-6 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'guide' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Guia de Configuração
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        <div className="max-w-6xl mx-auto">
          
          {/* Global Config Panel */}
          <div className="mb-8 bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
            <div className="p-4 bg-amber-500/5 border-b border-amber-500/10 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0">
                  <Zap size={16} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-foreground">Configuração do Servidor Evolution</h4>
                  <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Conexão Global</p>
                </div>
              </div>
              <button 
                onClick={() => setIsEditingConfig(!isEditingConfig)}
                className="text-xs font-bold text-primary hover:underline"
              >
                {isEditingConfig ? 'Cancelar' : 'Editar Configurações'}
              </button>
            </div>

            {isEditingConfig ? (
              <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 animate-in slide-in-from-top-2 duration-300">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-muted-foreground uppercase ml-1">Evolution API URL</label>
                    <span className="text-[10px] text-amber-500 font-bold uppercase">(Insira sem o https, ex: api.dominio.com)</span>
                  </div>
                  <input 
                    type="text" 
                    value={apiUrl}
                    onChange={(e) => setApiUrl(e.target.value)}
                    placeholder="api.sua-evolution.com"
                    className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary/50 transition-all font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase ml-1">Global API Key</label>
                  <input 
                    type="password" 
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Sua chave secreta global"
                    className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary/50 transition-all font-mono"
                  />
                </div>
                <div className="md:col-span-2 space-y-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase ml-1">Webhook URL (Recebimento de Mensagens)</label>
                  <input 
                    type="text" 
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="https://seu-dominio.com/api/webhooks/evolution"
                    className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary/50 transition-all font-mono"
                  />
                </div>
                <div className="md:col-span-2 flex justify-end">
                  <button 
                    disabled={savingConfig}
                    onClick={handleSaveConfig}
                    className="bg-primary text-primary-foreground px-8 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
                  >
                    {savingConfig ? <RefreshCw className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}
                    Salvar Alterações
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
                <div className="flex flex-wrap items-center gap-6">
                   <div className="flex flex-col">
                      <span className="text-muted-foreground font-semibold uppercase tracking-tighter text-[9px]">URL da Evolution</span>
                      <span className="text-foreground font-mono truncate max-w-[180px]">{apiUrl || 'Não configurado'}</span>
                   </div>
                   <div className="flex flex-col">
                      <span className="text-muted-foreground font-semibold uppercase tracking-tighter text-[9px]">Chave Global</span>
                      <span className="text-foreground font-mono">{apiKey ? '••••••••••••' : 'Não configurada'}</span>
                   </div>
                   <div className="flex flex-col">
                      <span className="text-muted-foreground font-semibold uppercase tracking-tighter text-[9px]">Webhook (Sistema)</span>
                      <span className="text-foreground font-mono truncate max-w-[180px]">{webhookUrl || 'André Lustosa (Padrão)'}</span>
                   </div>
                </div>
                {apiStatus === 'online' ? (
                  <div className="flex items-center gap-2 text-emerald-500 font-bold bg-emerald-500/10 px-3 py-1.5 rounded-full border border-emerald-500/20">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                    CONECTADO
                  </div>
                ) : apiStatus === 'offline' ? (
                  <div className="flex items-center gap-2 text-rose-500 font-bold bg-rose-500/10 px-3 py-1.5 rounded-full border border-rose-500/20">
                    <div className="w-2 h-2 rounded-full bg-rose-500"></div>
                    SEM CONEXÃO
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-muted-foreground font-bold bg-muted px-3 py-1.5 rounded-full">
                    <RefreshCw className="animate-spin" size={12} />
                    VERIFICANDO
                  </div>
                )}
              </div>
            )}
          </div>

          {activeTab === 'guide' ? (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <StepCard 
                  number="1"
                  title="Acesse o Painel Evolution"
                  description="Abra o endereço da sua Evolution API (geralmente fornecido pela TI) e faça login com sua Global Key."
                />
                <StepCard 
                  number="2"
                  title="Crie uma Instância Local"
                  description="Aqui no CRM, clique em 'Nova Instância' e dê um nome amigável (ex: Comercial)."
                  badge="Importante"
                />
                <StepCard 
                  number="3"
                  title="Escaneie o QR Code"
                  description="Use o WhatsApp do seu celular em 'Aparelhos Conectados' para ler o código gerado pelo sistema."
                />
              </div>

              <div className="bg-primary/5 border border-primary/20 rounded-2xl p-8 flex flex-col md:flex-row gap-8 items-center mt-12">
                <div className="flex-1 text-center md:text-left">
                  <h3 className="text-2xl font-bold text-foreground mb-4">Pronto para começar?</h3>
                  <p className="text-muted-foreground mb-6">A integração permite que o sistema envie e receba mensagens automaticamente, além de alimentar a Inbox em tempo real.</p>
                  <button 
                    onClick={() => setActiveTab('instances')}
                    className="bg-primary text-primary-foreground px-8 py-3 rounded-xl font-bold shadow-lg shadow-primary/20 hover:-translate-y-1 transition-all"
                  >
                    Ir para Minhas Instâncias
                  </button>
                </div>
                <div className="w-48 h-48 bg-background border border-border rounded-3xl rotate-3 flex items-center justify-center shadow-2xl shrink-0">
                  <MessageSquare size={80} className="text-primary opacity-20" />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-6 rounded-2xl border border-border">
                <div className="flex items-center gap-4">
                  <div className="bg-muted p-3 rounded-xl">
                    <Plus className="text-muted-foreground" size={20} />
                  </div>
                  <div className="flex-1">
                    <input 
                      type="text" 
                      placeholder="Nome da Instância (ex: Vendas)" 
                      className="bg-transparent border-none outline-none font-bold text-lg text-foreground w-full"
                      value={newInstanceName}
                      onChange={(e) => setNewInstanceName(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Use um nome simples sem espaços.</p>
                  </div>
                </div>
                <button 
                  disabled={creating || !newInstanceName.trim()}
                  onClick={handleCreateInstance}
                  className="bg-primary text-primary-foreground px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-primary/90 transition-all disabled:opacity-50"
                >
                  {creating ? <RefreshCw className="animate-spin" size={18} /> : <Plus size={18} />}
                  Criar Instância
                </button>
              </div>

              {loading ? (
                <div className="py-20 flex flex-col items-center gap-4 text-muted-foreground">
                  <RefreshCw className="animate-spin" size={40} />
                  <p className="font-medium">Carregando instâncias...</p>
                </div>
              ) : instances.length === 0 ? (
                <div className="py-20 bg-card border border-dashed border-border rounded-3xl flex flex-col items-center justify-center text-center px-6">
                  <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                    <HelpCircle size={32} className="text-muted-foreground opacity-30" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground mb-2">Nenhuma instância encontrada</h3>
                  <p className="text-muted-foreground max-w-sm mb-6">Você ainda não possui números conectados. Crie sua primeira instância acima para começar.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {instances.map((instance) => {
                    const isConnected = instance.status === 'open';
                    return (
                      <div key={instance.instanceName} className="bg-card border border-border rounded-2xl overflow-hidden group hover:border-primary/20 transition-all shadow-sm">
                        <div className="p-6 border-b border-border/50">
                          <div className="flex items-start justify-between mb-4">
                            <div className="flex items-center gap-3">
                              <div className="w-12 h-12 rounded-full bg-muted border border-border overflow-hidden flex items-center justify-center bg-gradient-to-tr from-accent to-background">
                                {instance.profilePictureUrl ? (
                                  <img src={instance.profilePictureUrl} alt={instance.instanceName} className="w-full h-full object-cover" />
                                ) : (
                                  <span className="font-bold text-muted-foreground">{instance.instanceName[0].toUpperCase()}</span>
                                )}
                              </div>
                              <div>
                                <h4 className="font-bold text-foreground truncate max-w-[150px]">{instance.profileName || instance.instanceName}</h4>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 antialiased animate-pulse' : 'bg-red-500'}`}></div>
                                  <span className={`text-[10px] font-bold uppercase tracking-wider ${isConnected ? 'text-emerald-500' : 'text-red-500'}`}>
                                    {isConnected ? 'Conectado' : 'Desconectado'}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <button 
                              onClick={() => handleDeleteInstance(instance.instanceName)}
                              className="p-2 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                          
                          <div className="space-y-2">
                             <div className="flex justify-between text-xs">
                                <span className="text-muted-foreground">ID:</span>
                                <span className="text-foreground font-mono">{instance.instanceName}</span>
                             </div>
                             {instance.owner && (
                               <div className="flex justify-between text-xs">
                                  <span className="text-muted-foreground">Número:</span>
                                  <span className="text-foreground">{instance.owner.split('@')[0]}</span>
                               </div>
                             )}
                          </div>
                        </div>
                        
                        <div className="p-4 bg-muted/30 flex items-center justify-between">
                           {!isConnected ? (
                              <button 
                                onClick={() => handleOpenConnect(instance.instanceName)}
                                className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-xs flex items-center justify-center gap-2 hover:bg-primary/90 transition-all"
                              >
                                <QrCode size={16} />
                                Conectar WhatsApp
                              </button>
                           ) : (
                              <div className="w-full flex items-center justify-center gap-2 text-xs font-bold text-emerald-500 py-2.5">
                                 <CheckCircle2 size={16} />
                                 Sincronizado
                              </div>
                           )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Connection Modal */}
      {showConnectModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-card w-full max-w-md rounded-3xl border border-border shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-8 text-center">
              <h3 className="text-2xl font-bold text-foreground mb-2">Conectar Instância</h3>
              <p className="text-muted-foreground mb-8">Escaneie o código abaixo com o seu WhatsApp corporativo.</p>
              
              <div className="aspect-square w-full max-w-[280px] mx-auto bg-white p-4 rounded-2xl shadow-inner relative flex items-center justify-center border-4 border-primary/20">
                {qrCode ? (
                  <img src={qrCode} alt="WhatsApp QR Code" className="w-full h-full" />
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <RefreshCw className="animate-spin text-primary" size={48} />
                    <p className="text-black/40 text-xs font-bold uppercase tracking-widest">Gerando Código...</p>
                  </div>
                )}
              </div>

              <div className="mt-8 space-y-4">
                <div className="bg-muted p-4 rounded-2xl flex items-start gap-3 text-left">
                  <Info size={18} className="text-primary mt-0.5" />
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Vá em <strong>Configurações &gt; Aparelhos Conectados</strong> no seu celular e aponte a câmera para esta tela.
                  </p>
                </div>
                
                <button 
                  onClick={() => setShowConnectModal(false)}
                  className="w-full py-4 text-sm font-bold text-muted-foreground hover:text-foreground transition-all"
                >
                  Fechar Janela
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
