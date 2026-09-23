'use server';

import { obterSessao } from '@/lib/sessao';
import { supabaseServidor } from '@/lib/supabase';
import type { Resultado } from '@/lib/painel-tipos';

export async function alterarSenha(nova: string, confirmacao: string): Promise<Resultado> {
  const sessao = await obterSessao();
  if (!sessao) return { ok: false, erro: 'Sessão expirada. Entre novamente.' };
  if (nova.length < 8) return { ok: false, erro: 'A nova senha deve ter pelo menos 8 caracteres.' };
  if (nova !== confirmacao) return { ok: false, erro: 'As senhas não conferem.' };
  const sb = await supabaseServidor();
  const { error } = await sb.auth.updateUser({ password: nova });
  if (error) return { ok: false, erro: /different|same/i.test(error.message) ? 'Use uma senha diferente da atual.' : 'Não foi possível alterar a senha.' };
  return { ok: true, mensagem: 'Senha alterada' };
}
