// Slug = endereço público da barbearia (/<slug>). Mesmas regras das constraints do banco.

export const SLUGS_RESERVADOS = [
  'entrar', 'sair', 'login', 'logout', 'painel', 'admin', 'api', 'auth',
  'app', 'www', 'static', 'public', 'assets', 'demo-admin', 'suporte', 'ajuda',
];

export function slugificar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

/** Mensagem de erro ou null se o formato for válido. */
export function validarSlug(slug: string): string | null {
  if (slug.length < 2 || slug.length > 60) return 'Use de 2 a 60 caracteres.';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return 'Use só letras minúsculas, números e hífens (sem espaços ou acentos).';
  if (SLUGS_RESERVADOS.includes(slug)) return 'Esse endereço é reservado pelo sistema.';
  return null;
}
