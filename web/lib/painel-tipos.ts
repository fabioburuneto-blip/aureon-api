// Tipos compartilhados entre servidor e cliente na área logada.

export type Status = 'confirmado' | 'concluido' | 'cancelado' | 'faltou';

export type AgendamentoPainel = {
  id: string;
  inicio: string;
  fim: string;
  status: Status;
  origem: 'online' | 'manual';
  preco_cobrado: number | null;
  observacao: string | null;
  profissional_id: string;
  cliente: { id: string; nome: string; telefone: string } | null;
  servico: { id: string; nome: string; duracao_min: number } | null;
};

export type ProfissionalPainel = { id: string; nome: string; foto_url: string | null; ativo: boolean; ordem: number };

export type ServicoPainel = {
  id: string;
  nome: string;
  descricao: string | null;
  preco: number;
  duracao_min: number;
  ativo: boolean;
  ordem: number;
};

export type Resultado = { ok: true; mensagem?: string } | { ok: false; erro: string };

export const ROTULO_STATUS: Record<Status, string> = {
  confirmado: 'Confirmado',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
  faltou: 'Faltou',
};

/** Cor estável por profissional (índice na lista) para diferenciar na agenda. */
export const CORES_PROFISSIONAIS = ['#8b9cff', '#34d399', '#f59e0b', '#f472b6', '#22d3ee', '#a78bfa', '#fb7185', '#84cc16'];
