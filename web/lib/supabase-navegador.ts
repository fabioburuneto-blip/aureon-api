'use client';

import { createBrowserClient } from '@supabase/ssr';

let cliente: ReturnType<typeof createBrowserClient> | null = null;

/** Cliente do navegador com a sessão atual (usado para upload de imagens no Storage). */
export function supabaseNavegador() {
  cliente ??= createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  return cliente;
}

const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/**
 * Reduz fotos grandes do celular antes do envio (lado maior até `max` px).
 * PNG continua PNG (preserva transparência de logos); o resto vira JPEG. GIF não é mexido.
 */
async function reduzir(arquivo: File, max: number): Promise<File> {
  if (arquivo.type === 'image/gif') return arquivo;
  try {
    const bmp = await createImageBitmap(arquivo);
    const escala = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (escala === 1 && arquivo.size < 1.5 * 1024 * 1024) return arquivo;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * escala);
    canvas.height = Math.round(bmp.height * escala);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const tipo = arquivo.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, tipo, 0.86));
    return blob ? new File([blob], arquivo.name, { type: tipo }) : arquivo;
  } catch {
    return arquivo;
  }
}

/**
 * Envia uma imagem para o bucket público "barbearias" em <barbearia_id>/<pasta>/<aleatório>.<ext>
 * e devolve a URL pública. As políticas do bucket só aceitam a pasta da própria barbearia.
 */
export async function enviarImagem(barbeariaId: string, pasta: string, original: File, max = 1600): Promise<string> {
  if (!TIPOS.includes(original.type)) throw new Error('Envie uma imagem JPG, PNG, WEBP ou GIF.');
  const arquivo = await reduzir(original, max);
  if (arquivo.size > 5 * 1024 * 1024) throw new Error('A imagem deve ter até 5 MB.');
  const ext = arquivo.type.split('/')[1].replace('jpeg', 'jpg');
  const caminho = `${barbeariaId}/${pasta}/${crypto.randomUUID()}.${ext}`;
  const sb = supabaseNavegador();
  const { error } = await sb.storage.from('barbearias').upload(caminho, arquivo, {
    cacheControl: '31536000',
    contentType: arquivo.type,
    upsert: false,
  });
  if (error) throw new Error(`Falha no envio: ${error.message}`);
  return sb.storage.from('barbearias').getPublicUrl(caminho).data.publicUrl;
}
