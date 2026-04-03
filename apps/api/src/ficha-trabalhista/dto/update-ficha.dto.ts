import { IsOptional, IsString } from 'class-validator';

export class UpdateFichaDto {
  // Dados Pessoais
  @IsOptional() @IsString() nome_completo?: string;
  @IsOptional() @IsString() nome_mae?: string;
  @IsOptional() @IsString() telefone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() cpf?: string;
  @IsOptional() @IsString() rg?: string;
  @IsOptional() @IsString() orgao_emissor?: string;
  @IsOptional() @IsString() data_nascimento?: string;
  @IsOptional() @IsString() estado_civil?: string;
  @IsOptional() @IsString() nacionalidade?: string;
  @IsOptional() @IsString() profissao?: string;
  // Endereço
  @IsOptional() @IsString() cep?: string;
  @IsOptional() @IsString() logradouro?: string;
  @IsOptional() @IsString() numero?: string;
  @IsOptional() @IsString() bairro?: string;
  @IsOptional() @IsString() cidade?: string;
  @IsOptional() @IsString() estado_uf?: string;
  // Contrato
  @IsOptional() @IsString() nome_empregador?: string;
  @IsOptional() @IsString() cnpjcpf_empregador?: string;
  @IsOptional() @IsString() cidade_trabalho?: string;
  @IsOptional() @IsString() data_admissao?: string;
  @IsOptional() @IsString() data_saida?: string;
  @IsOptional() @IsString() situacao_atual?: string;
  @IsOptional() @IsString() motivo_saida?: string;
  @IsOptional() @IsString() ctps_numero?: string;
  @IsOptional() @IsString() pis_pasep?: string;
  @IsOptional() @IsString() ctps_assinada_corretamente?: string;
  @IsOptional() @IsString() periodo_sem_carteira?: string;
  @IsOptional() @IsString() funcao?: string;
  @IsOptional() @IsString() salario?: string;
  @IsOptional() @IsString() periodicidade_pagamento?: string;
  @IsOptional() @IsString() atividades_realizadas?: string;
  // Jornada
  @IsOptional() @IsString() horario_entrada?: string;
  @IsOptional() @IsString() horario_saida?: string;
  @IsOptional() @IsString() tempo_intervalo?: string;
  @IsOptional() @IsString() dias_trabalhados?: string;
  @IsOptional() @IsString() fazia_horas_extras?: string;
  @IsOptional() @IsString() qtd_horas_extras_dia?: string;
  @IsOptional() @IsString() tipo_controle_ponto?: string;
  @IsOptional() @IsString() horas_extras_pagas_corretamente?: string;
  @IsOptional() @IsString() possui_copia_ponto?: string;
  @IsOptional() @IsString() ponto_refletia_realidade?: string;
  @IsOptional() @IsString() horario_real_trabalhado?: string;
  // Pagamentos
  @IsOptional() @IsString() recebia_por_fora?: string;
  @IsOptional() @IsString() outro_valor_por_fora?: string;
  @IsOptional() @IsString() recebia_vale_transporte?: string;
  @IsOptional() @IsString() precisava_vt?: string;
  @IsOptional() @IsString() valor_gasto_vt?: string;
  @IsOptional() @IsString() premio_comissao?: string;
  @IsOptional() @IsString() natureza_premio?: string;
  @IsOptional() @IsString() valor_premio?: string;
  @IsOptional() @IsString() periodicidade_premio?: string;
  @IsOptional() @IsString() tem_prova_premio?: string;
  @IsOptional() @IsString() periodicidade_comissao?: string;
  @IsOptional() @IsString() natureza_comissao?: string;
  @IsOptional() @IsString() valor_comissao?: string;
  @IsOptional() @IsString() tem_prova_comissao?: string;
  // Segurança
  @IsOptional() @IsString() ambiente_insalubre_perigoso?: string;
  @IsOptional() @IsString() ambiente_insalubre?: string;
  @IsOptional() @IsString() forneciam_epis?: string;
  @IsOptional() @IsString() sofreu_acidente?: string;
  @IsOptional() @IsString() detalhes_acidente?: string;
  @IsOptional() @IsString() recebeu_auxilio_b91?: string;
  @IsOptional() @IsString() tempo_cessacao_beneficio?: string;
  @IsOptional() @IsString() sofreu_assedio_moral?: string;
  @IsOptional() @IsString() detalhes_assedio_moral?: string;
  // FGTS
  @IsOptional() @IsString() fgts_depositado?: string;
  @IsOptional() @IsString() fgts_sacado?: string;
  // Verbas
  @IsOptional() @IsString() tem_ferias_pendentes?: string;
  @IsOptional() @IsString() tem_decimo_terceiro_pendente?: string;
  @IsOptional() @IsString() detalhes_verbas_pendentes?: string;
  // Testemunhas
  @IsOptional() @IsString() possui_testemunhas?: string;
  @IsOptional() @IsString() detalhes_testemunhas?: string;
  @IsOptional() @IsString() possui_provas_documentais?: string;
  @IsOptional() @IsString() detalhes_provas_documentais?: string;
  // Resumo
  @IsOptional() @IsString() motivos_reclamacao?: string;
}
