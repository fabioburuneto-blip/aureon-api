import 'server-only';
import { cache } from 'react';
import { createClient } from '@supabase/supabase-js';

export type Layout = 'classico' | 'urbano' | 'luxo' | 'minimalista';
export type ParFontes = 'elegante' | 'moderna' | 'classica' | 'impacto';

export type Tema = {
  layout: Layout;
  cor_primaria: string;
  cor_destaque: string;
  cor_fundo: string;
  cor_texto: string;
  par_fontes: ParFontes;
  logo_url: string;
  foto_capa_url: string;
  galeria: string[];
  titulo_hero: string;
  subtitulo_hero: string;
  texto_sobre: string;
};

export type Servico = {
  id: string;
  nome: string;
  descricao: string | null;
  preco: number;
  duracao_min: number;
};

export type Profissional = {
  id: string;
  nome: string;
  foto_url: string | null;
};

export type DiaFuncionamento = { aberto: boolean; abre: string | null; fecha: string | null };

export type Barbearia = {
  id: string;
  slug: string;
  nome: string;
  whatsapp: string | null;
  endereco: string | null;
  cidade: string | null;
  instagram: string | null;
  horario_funcionamento: Record<string, DiaFuncionamento>;
  tema: Tema;
  servicos: Servico[];
  profissionais: Profissional[];
};

const SLUG_VALIDO = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function supabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY (veja .env.example).');
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * Busca a barbearia ativa pelo slug (RPC barbearia_publica).
 * Retorna null se não existir ou estiver inativa.
 * `cache` evita chamada dupla entre generateMetadata e a página.
 */
export const buscarBarbearia = cache(async (slug: string): Promise<Barbearia | null> => {
  const s = decodeURIComponent(slug).trim().toLowerCase();
  if (!SLUG_VALIDO.test(s)) return null;

  const { data, error } = await supabase().rpc('barbearia_publica', { p_slug: s });
  if (error) throw new Error(`Erro ao buscar barbearia "${s}": ${error.message}`);
  return (data as Barbearia | null) ?? null;
});
