'use client';

import { useState, useEffect } from 'react';
import { Bot, KeyRound, CheckCircle2, RefreshCw, Eye, EyeOff, Sparkles } from 'lucide-react';
import api from '@/lib/api';

export default function AiSettingsPage() {
  const [apiKey, setApiKey] = useState('');
  const [isConfigured, setIsConfigured] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await api.get('/settings/ai-config');
        setIsConfigured(res.data.isConfigured);
        // Never pre-fill the key for security; only show configured status
      } catch (e) {
        console.error('Erro ao carregar config IA:', e);
      } finally {
        setLoading(false);
      }
    };
    fetchConfig();
  }, []);

  const handleSave = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      await api.post('/settings/ai-config', { apiKey: apiKey.trim() });
      setIsConfigured(true);
      setIsEditing(false);
      setApiKey('');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      console.error('Erro ao salvar chave OpenAI:', e);
      alert('Erro ao salvar. Verifique se você é administrador.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col pt-8 overflow-hidden bg-background">
      <header className="px-8 mb-6 shrink-0">
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Ajustes IA</h1>
        <p className="text-[13px] text-muted-foreground mt-1">Configure o comportamento da inteligência artificial no atendimento.</p>
      </header>

      <div className="flex-1 overflow-y-auto px-8 pb-8 flex flex-col gap-6">

        {/* OpenAI API Key Card */}
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between bg-primary/5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <KeyRound size={16} />
              </div>
              <div>
                <h4 className="text-sm font-bold text-foreground">Chave de API — OpenAI</h4>
                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Provedor de IA</p>
              </div>
            </div>
            {!loading && (
              <button
                onClick={() => { setIsEditing(!isEditing); setApiKey(''); setShowKey(false); }}
                className="text-xs font-bold text-primary hover:underline"
              >
                {isEditing ? 'Cancelar' : isConfigured ? 'Atualizar Chave' : 'Configurar'}
              </button>
            )}
          </div>

          {loading ? (
            <div className="p-6 flex items-center justify-center">
              <RefreshCw className="animate-spin text-muted-foreground" size={20} />
            </div>
          ) : isEditing ? (
            <div className="p-6 space-y-4 animate-in slide-in-from-top-2 duration-200">
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground uppercase ml-1">
                  OpenAI API Key
                </label>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-proj-..."
                    className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 pr-10 text-sm outline-none focus:border-primary/50 transition-all font-mono"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground ml-1">
                  Encontre sua chave em <span className="font-mono text-primary">platform.openai.com/api-keys</span>
                </p>
              </div>
              <div className="flex justify-end">
                <button
                  disabled={saving || !apiKey.trim()}
                  onClick={handleSave}
                  className="bg-primary text-primary-foreground px-8 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-primary/90 transition-all disabled:opacity-50 shadow-lg shadow-primary/20"
                >
                  {saving ? <RefreshCw className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}
                  Salvar Chave
                </button>
              </div>
            </div>
          ) : (
            <div className="p-4 flex items-center justify-between text-xs">
              <div className="flex items-center gap-3">
                <div className="flex flex-col">
                  <span className="text-muted-foreground font-semibold uppercase tracking-tighter text-[9px]">Chave API</span>
                  <span className="text-foreground font-mono">{isConfigured ? '••••••••••••••••••••' : 'Não configurada'}</span>
                </div>
              </div>
              {saved ? (
                <div className="flex items-center gap-2 text-emerald-500 font-bold bg-emerald-500/10 px-3 py-1.5 rounded-full border border-emerald-500/20">
                  <CheckCircle2 size={12} />
                  SALVO
                </div>
              ) : isConfigured ? (
                <div className="flex items-center gap-2 text-emerald-500 font-bold bg-emerald-500/10 px-3 py-1.5 rounded-full border border-emerald-500/20">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                  CONFIGURADO
                </div>
              ) : (
                <div className="flex items-center gap-2 text-amber-500 font-bold bg-amber-500/10 px-3 py-1.5 rounded-full border border-amber-500/20">
                  <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                  NÃO CONFIGURADO
                </div>
              )}
            </div>
          )}
        </div>

        {/* Info Card */}
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border flex items-center gap-3 bg-primary/5">
            <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Bot size={16} />
            </div>
            <div>
              <h4 className="text-sm font-bold text-foreground">Como funciona o Agente IA</h4>
              <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Modo automático</p>
            </div>
          </div>
          <div className="p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold">1</div>
              <div>
                <p className="text-sm font-semibold text-foreground">Ative o Modo IA na conversa</p>
                <p className="text-xs text-muted-foreground mt-0.5">Dentro de qualquer conversa, clique no botão "Modo IA" para que o agente assuma o atendimento automaticamente.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold">2</div>
              <div>
                <p className="text-sm font-semibold text-foreground">O agente pré-qualifica o lead</p>
                <p className="text-xs text-muted-foreground mt-0.5">A IA responde no WhatsApp com empatia, coleta informações do caso e classifica a área do direito (civil, criminal, trabalhista, etc.).</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold">3</div>
              <div>
                <p className="text-sm font-semibold text-foreground">Advogado assume quando pronto</p>
                <p className="text-xs text-muted-foreground mt-0.5">Ao atribuir a conversa para um advogado, o Modo IA é desativado automaticamente.</p>
              </div>
            </div>
          </div>
          <div className="px-6 pb-6">
            <div className="bg-muted/50 border border-border rounded-xl p-4 flex items-center gap-3">
              <Sparkles size={16} className="text-primary shrink-0" />
              <p className="text-xs text-muted-foreground">
                Modelo utilizado: <span className="font-mono font-bold text-foreground">gpt-4o-mini</span> — rápido, econômico e ideal para pré-atendimento.
              </p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
