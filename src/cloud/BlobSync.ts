// Sincronização com um contêiner do Azure Blob Storage via URL SAS (somente leitura + listagem).
// A URL SAS fica salva apenas neste aparelho (localStorage); nunca vai para o código.

export interface CloudBlob {
  name: string; // caminho completo no contêiner, ex.: "Caetano/Luz do Sol.mp3"
  size: number;
  etag: string;
}

const KEY = 'aether_cloud_sas_url';
const AUDIO_EXT = /\.(mp3|m4a|aac|flac|wav|ogg|opus|aiff?|alac)$/i;

export const getCloudUrl = () => localStorage.getItem(KEY);
export const setCloudUrl = (url: string) => localStorage.setItem(KEY, url.trim());
export const clearCloudUrl = () => localStorage.removeItem(KEY);

interface ParsedSas {
  base: string; // https://conta.blob.core.windows.net/contêiner
  query: string; // sv=...&sig=...
}

export function parseSasUrl(raw: string): ParsedSas {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('Cole a URL SAS completa do contêiner (começa com https://).');
  }
  if (!url.hostname.endsWith('.blob.core.windows.net')) {
    throw new Error('A URL precisa ser do Azure Blob Storage (….blob.core.windows.net).');
  }
  const container = url.pathname.split('/').filter(Boolean)[0];
  if (!container) throw new Error('A URL precisa incluir o nome do contêiner, ex.: …/musicas?sv=…');
  if (!url.searchParams.get('sig')) throw new Error('A URL não tem a assinatura SAS (parâmetro sig).');
  return { base: `${url.origin}/${container}`, query: url.search.slice(1) };
}

/** Nome do arquivo sem pasta e sem extensão, usado para casar com as faixas do Spotify. */
export const displayName = (blobName: string) =>
  (blobName.split('/').pop() ?? blobName).replace(/\.[^/.]+$/, '');

export async function listCloudAudio(rawUrl: string): Promise<CloudBlob[]> {
  const { base, query } = parseSasUrl(rawUrl);
  const result: CloudBlob[] = [];
  let marker = '';
  do {
    let res: Response;
    try {
      res = await fetch(`${base}?restype=container&comp=list&${query}${marker ? `&marker=${encodeURIComponent(marker)}` : ''}`);
    } catch {
      throw new Error('Não consegui acessar o Azure. Verifique o CORS da conta de armazenamento.');
    }
    if (res.status === 403) throw new Error('Acesso negado: a URL SAS expirou ou não tem permissão de Ler e Listar.');
    if (!res.ok) throw new Error(`O Azure respondeu ${res.status}.`);
    const xml = new DOMParser().parseFromString(await res.text(), 'application/xml');
    xml.querySelectorAll('Blob').forEach((b) => {
      const name = b.querySelector('Name')?.textContent ?? '';
      if (!AUDIO_EXT.test(name)) return;
      result.push({
        name,
        size: Number(b.querySelector('Content-Length')?.textContent ?? 0),
        etag: b.querySelector('Etag')?.textContent ?? '',
      });
    });
    marker = xml.querySelector('NextMarker')?.textContent ?? '';
  } while (marker);
  return result;
}

export async function downloadCloudBlob(rawUrl: string, blobName: string): Promise<Blob> {
  const { base, query } = parseSasUrl(rawUrl);
  const path = blobName.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`${base}/${path}?${query}`);
  if (!res.ok) throw new Error(`Falha ao baixar “${displayName(blobName)}” (${res.status}).`);
  return res.blob();
}
