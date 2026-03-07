'use client';

import { X, UserCheck } from 'lucide-react';
import { TransferAudioRecorder } from '@/components/TransferAudioRecorder';
import { AuthAudioPlayer } from '@/components/AuthAudioPlayer';
import type { ConversationSummary } from '../types';

// ─── Types ──────────────────────────────────────────────────────

interface Group {
  id: string;
  name: string;
  type: string;
  auto_route?: boolean;
  users: { id: string; name: string }[];
}

export interface TransferModalsProps {
  // Transfer Modal
  transferModal: boolean;
  onCloseTransferModal: () => void;
  transferGroups: Group[];
  loadingOperators: boolean;
  transferError: string | null;
  selectedTransferUserId: string | null;
  onSelectTransferUser: (id: string | null) => void;
  selected: ConversationSummary | null;
  onOpenReasonPopup: (context: 'lawyer' | 'operator' | 'return', targetName: string) => void;

  // Reason Popup
  showReasonPopup: boolean;
  reasonPopupContext: string | null;
  reasonPopupTargetName: string;
  transferReason: string;
  onSetTransferReason: (r: string) => void;
  transferring: boolean;
  onCloseReasonPopup: () => void;
  onTransferToLawyer: () => void;
  onReturnWithReason: () => void;
  onTransfer: () => void;
  onSetTransferAudioIds: (ids: string[]) => void;
  selectedConversationId: string | null;

  // Incoming Transfer
  incomingTransfer: { conversationId: string; fromUserName: string; contactName: string; reason: string | null; audioIds?: string[] } | null;
  onCloseIncomingTransfer: () => void;
  showDeclineInput: boolean;
  onSetShowDeclineInput: (v: boolean) => void;
  declineReason: string;
  onSetDeclineReason: (r: string) => void;
  processingTransfer: boolean;
  onAcceptTransfer: () => void;
  onDeclineTransfer: () => void;

  // Banners
  transferSentMsg: string | null;
  onClearTransferSentMsg: () => void;
  transferResponseMsg: string | null;
  onClearTransferResponseMsg: () => void;
}

// ─── Component ──────────────────────────────────────────────────

export function TransferModals({
  transferModal, onCloseTransferModal, transferGroups, loadingOperators, transferError,
  selectedTransferUserId, onSelectTransferUser, selected, onOpenReasonPopup,
  showReasonPopup, reasonPopupContext, reasonPopupTargetName, transferReason,
  onSetTransferReason, transferring, onCloseReasonPopup, onTransferToLawyer,
  onReturnWithReason, onTransfer, onSetTransferAudioIds, selectedConversationId,
  incomingTransfer, onCloseIncomingTransfer, showDeclineInput, onSetShowDeclineInput,
  declineReason, onSetDeclineReason, processingTransfer, onAcceptTransfer, onDeclineTransfer,
  transferSentMsg, onClearTransferSentMsg, transferResponseMsg, onClearTransferResponseMsg,
}: TransferModalsProps) {
  return (
    <>
      {/* ── Transfer Modal ── */}
      {transferModal && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center backdrop-blur-sm"
          onClick={onCloseTransferModal}
        >
          <div
            className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-4 shrink-0">
              <UserCheck size={18} className="text-sky-400" />
              <h3 className="font-bold text-base">Solicitar Transferencia</h3>
            </div>
            {transferError && (
              <p className="text-red-400 text-sm mb-3 px-1">{transferError}</p>
            )}
            {loadingOperators ? (
              <div className="flex flex-col items-center justify-center py-10 gap-3">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <p className="text-muted-foreground text-sm">Carregando operadores...</p>
              </div>
            ) : transferGroups.every(g => g.users.length === 0) || transferGroups.length === 0 ? (
              <p className="text-muted-foreground text-sm py-2">Nenhum operador cadastrado.</p>
            ) : (
              <>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2 px-1 shrink-0">Selecione o destino</p>
                <div className="flex flex-col gap-4 overflow-y-auto custom-scrollbar flex-1 min-h-0">
                  {transferGroups.filter(g => g.users.length > 0 || (g.type === 'SECTOR' && g.auto_route)).map(group => (
                    <div key={group.id}>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5 px-1">
                        {group.type === 'SECTOR' ? (group.auto_route ? '\u2696\uFE0F' : '\uD83C\uDFE2') : '\uD83D\uDCE5'} {group.name}
                        {group.auto_route && <span className="ml-1 text-violet-400">(auto)</span>}
                      </p>
                      {group.type === 'SECTOR' && group.auto_route ? (
                        <div className="space-y-2">
                          {selected?.assignedLawyerId ? (
                            (() => {
                              const lawyer = group.users.find(u => u.id === selected.assignedLawyerId);
                              const lawyerName = lawyer?.name || selected.assignedLawyerName || 'Advogado vinculado';
                              return (
                                <button
                                  onClick={() => onOpenReasonPopup('lawyer', lawyerName)}
                                  className="w-full py-3 bg-violet-500/10 border border-violet-500/30 text-violet-300 rounded-xl font-bold text-sm hover:bg-violet-500/20 transition-colors flex items-center justify-center gap-2"
                                >
                                  \u2696\uFE0F Transferir para {lawyerName}{selected.legalArea ? ` (${selected.legalArea})` : ''}
                                </button>
                              );
                            })()
                          ) : (
                            group.users.length > 0 ? (
                              <div className="flex flex-col gap-1">
                                {group.users.map(user => (
                                  <button
                                    key={user.id}
                                    onClick={() => onSelectTransferUser(user.id)}
                                    className={`w-full text-left px-4 py-2.5 rounded-xl border transition-colors font-medium text-sm ${
                                      selectedTransferUserId === user.id
                                        ? 'bg-sky-500/20 text-sky-400 border-sky-500/40'
                                        : 'bg-muted/30 hover:bg-sky-500/10 hover:text-sky-400 border-border hover:border-sky-500/30'
                                    }`}
                                  >
                                    {selectedTransferUserId === user.id && <span className="mr-2">\u2713</span>}
                                    {user.name}
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground text-center py-2 px-1 italic">
                                Nenhum advogado especialista cadastrado.
                              </p>
                            )
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {group.users.map(user => (
                            <button
                              key={user.id}
                              onClick={() => onSelectTransferUser(user.id)}
                              className={`w-full text-left px-4 py-2.5 rounded-xl border transition-colors font-medium text-sm ${
                                selectedTransferUserId === user.id
                                  ? 'bg-sky-500/20 text-sky-400 border-sky-500/40'
                                  : 'bg-muted/30 hover:bg-sky-500/10 hover:text-sky-400 border-border hover:border-sky-500/30'
                              }`}
                            >
                              {selectedTransferUserId === user.id && <span className="mr-2">\u2713</span>}
                              {user.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {selectedTransferUserId && (
                  <button
                    onClick={() => {
                      const destUser = transferGroups.flatMap(g => g.users).find(u => u.id === selectedTransferUserId);
                      onOpenReasonPopup('operator', destUser?.name || 'Operador');
                    }}
                    className="mt-3 shrink-0 w-full py-2.5 bg-sky-500 text-white rounded-xl font-bold text-sm hover:bg-sky-600 transition-colors"
                  >
                    Solicitar Transferencia
                  </button>
                )}
              </>
            )}
            <button
              onClick={onCloseTransferModal}
              className="mt-2 shrink-0 w-full py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ── Popup de Motivo de Transferencia ── */}
      {showReasonPopup && (
        <div
          className="fixed inset-0 bg-black/60 z-[9999] flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={onCloseReasonPopup}
        >
          <div
            className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-[360px] mx-4 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className={`px-5 pt-5 pb-3 border-b border-border/60 ${
              reasonPopupContext === 'lawyer' ? 'bg-violet-500/5' :
              reasonPopupContext === 'return' ? 'bg-amber-500/5' :
              'bg-sky-500/5'
            }`}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">
                {reasonPopupContext === 'lawyer' ? '\u2696\uFE0F Transferencia para especialista' :
                 reasonPopupContext === 'return' ? '\u21A9 Devolver contato' :
                 '\uD83D\uDCE8 Solicitar transferencia'}
              </p>
              <h3 className="font-bold text-sm text-foreground">
                {reasonPopupContext === 'return' ? `Para: ${reasonPopupTargetName}` : reasonPopupTargetName}
              </h3>
            </div>

            {/* Caixa unificada: textarea + gravador de audio */}
            <div className={`m-4 rounded-xl border bg-muted/40 overflow-hidden transition-colors ${
              reasonPopupContext === 'return' ? 'border-amber-500/30 focus-within:border-amber-500/60' :
              'border-border focus-within:border-violet-500/50'
            }`}>
              <textarea
                autoFocus
                value={transferReason}
                onChange={e => onSetTransferReason(e.target.value)}
                placeholder={
                  reasonPopupContext === 'return'
                    ? `Observacoes para ${reasonPopupTargetName} (opcional)...`
                    : `Explique o motivo para ${reasonPopupTargetName}...`
                }
                className="w-full bg-transparent px-4 pt-3 pb-2 text-sm resize-none outline-none min-h-[80px]"
                rows={3}
              />
              {/* Divisor + gravador dentro da mesma caixa */}
              <div className="border-t border-border/50 px-3 py-2.5 bg-muted/20">
                <TransferAudioRecorder
                  conversationId={selectedConversationId!}
                  onAudioIdsChange={onSetTransferAudioIds}
                />
              </div>
            </div>

            {/* Erro */}
            {transferError && (
              <p className="text-red-400 text-xs px-4 pb-2">{transferError}</p>
            )}

            {/* Botoes */}
            <div className="flex gap-2 px-4 pb-4">
              <button
                onClick={onCloseReasonPopup}
                className="flex-1 py-2.5 bg-muted border border-border text-muted-foreground rounded-xl text-sm font-semibold hover:bg-accent transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={
                  reasonPopupContext === 'lawyer' ? onTransferToLawyer :
                  reasonPopupContext === 'return' ? onReturnWithReason :
                  onTransfer
                }
                disabled={
                  transferring ||
                  (reasonPopupContext !== 'return' && !transferReason.trim())
                }
                className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  reasonPopupContext === 'lawyer'
                    ? 'bg-violet-500/15 border border-violet-500/40 text-violet-300 hover:bg-violet-500/25'
                    : reasonPopupContext === 'return'
                    ? 'bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25'
                    : 'bg-sky-500 text-white hover:bg-sky-600'
                }`}
              >
                {transferring ? '\u23F3 Enviando...' :
                 reasonPopupContext === 'lawyer' ? '\u2696\uFE0F Confirmar' :
                 reasonPopupContext === 'return' ? '\u21A9 Devolver' :
                 'Enviar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Incoming Transfer Popup ── */}
      {incomingTransfer && (
        <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center backdrop-blur-sm p-4">
          <div className="bg-card border-2 border-amber-500/40 rounded-2xl shadow-2xl w-full max-w-sm flex flex-col max-h-[90vh]">
            {/* Header fixo */}
            <div className="flex items-center gap-3 px-6 pt-6 pb-4 shrink-0">
              <span className="text-2xl">\uD83D\uDCE8</span>
              <div>
                <h3 className="font-bold text-base">Pedido de Transferencia</h3>
                <p className="text-xs text-muted-foreground">De: <strong className="text-foreground">{incomingTransfer.fromUserName}</strong></p>
              </div>
            </div>

            {/* Corpo rolavel */}
            <div className="overflow-y-auto px-6 flex-1 min-h-0">
              <div className="bg-muted/50 rounded-xl p-4 mb-4 space-y-3 text-sm">
                <p><span className="text-muted-foreground">Contato:</span> <strong>{incomingTransfer.contactName}</strong></p>
                {incomingTransfer.reason && (
                  <div>
                    <p className="text-muted-foreground text-xs mb-1">Motivo:</p>
                    <p className="whitespace-pre-wrap break-words leading-relaxed">{incomingTransfer.reason}</p>
                  </div>
                )}
                {incomingTransfer.audioIds && incomingTransfer.audioIds.length > 0 && (
                  <div>
                    <p className="text-muted-foreground text-xs mb-1.5">Audios explicativos ({incomingTransfer.audioIds.length}):</p>
                    <div className="space-y-1.5">
                      {incomingTransfer.audioIds.map((aid: string, i: number) => (
                        <div key={aid} className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground shrink-0">#{i + 1}</span>
                          <AuthAudioPlayer
                            audioId={aid}
                            className="h-7 w-full"
                            style={{ filter: 'hue-rotate(240deg) brightness(0.9)' }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {showDeclineInput && (
                <textarea
                  value={declineReason}
                  onChange={e => onSetDeclineReason(e.target.value)}
                  placeholder="Justificativa para recusa (opcional)..."
                  className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-sm mb-3 resize-none outline-none focus:border-red-500/50"
                  rows={2}
                  autoFocus
                />
              )}
            </div>

            {/* Botoes fixos no rodape */}
            <div className="px-6 pb-6 pt-2 shrink-0">
              <div className="flex gap-2">
                {!showDeclineInput ? (
                  <>
                    <button
                      onClick={onAcceptTransfer}
                      disabled={processingTransfer}
                      className="flex-1 py-2.5 bg-emerald-500 text-white rounded-xl font-bold text-sm hover:bg-emerald-600 transition-colors disabled:opacity-50"
                    >
                      \u2713 Aceitar
                    </button>
                    <button
                      onClick={() => onSetShowDeclineInput(true)}
                      disabled={processingTransfer}
                      className="flex-1 py-2.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl font-bold text-sm hover:bg-red-500/20 transition-colors"
                    >
                      \u2717 Recusar
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => onSetShowDeclineInput(false)}
                      className="py-2.5 px-4 text-muted-foreground text-sm rounded-xl hover:bg-accent transition-colors"
                    >
                      Voltar
                    </button>
                    <button
                      onClick={onDeclineTransfer}
                      disabled={processingTransfer}
                      className="flex-1 py-2.5 bg-red-500 text-white rounded-xl font-bold text-sm hover:bg-red-600 transition-colors disabled:opacity-50"
                    >
                      {processingTransfer ? 'Enviando...' : 'Confirmar Recusa'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Transfer Sent Banner */}
      {transferSentMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[90] bg-card border border-sky-500/30 rounded-2xl px-5 py-3 shadow-2xl text-sm font-medium flex items-center gap-3">
          {transferSentMsg}
          <button onClick={onClearTransferSentMsg} className="text-muted-foreground hover:text-foreground ml-2" aria-label="Fechar aviso"><X size={14} /></button>
        </div>
      )}

      {/* Transfer Response Banner */}
      {transferResponseMsg && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[90] bg-card border border-border rounded-2xl px-5 py-3 shadow-2xl text-sm font-medium flex items-center gap-3">
          {transferResponseMsg}
          <button onClick={onClearTransferResponseMsg} className="text-muted-foreground hover:text-foreground ml-2" aria-label="Fechar aviso">
            <X size={14} />
          </button>
        </div>
      )}
    </>
  );
}
