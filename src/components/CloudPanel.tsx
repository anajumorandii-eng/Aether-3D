import { useState } from 'react';
import { AlertCircle, Check, Cloud, CloudDownload, Loader2, RefreshCw, Unplug } from 'lucide-react';
import { PanelHeader } from './ui';

export interface CloudStatus {
  phase: 'idle' | 'checking' | 'downloading' | 'done' | 'error';
  cloudCount: number;
  total: number;
  done: number;
  current?: string;
  error?: string;
  lastSync?: number;
  failed?: number;
}

interface Props {
  configured: boolean;
  status: CloudStatus;
  onConnect: (url: string) => Promise<boolean>;
  onSync: () => void;
  onDisconnect: () => void;
}

const timeAgo = (t?: number) => {
  if (!t) return '';
  const min = Math.round((Date.now() - t) / 60000);
  return min < 1 ? 'agora há pouco' : min < 60 ? `há ${min} min` : `há ${Math.round(min / 60)} h`;
};

export function CloudPanel({ configured, status, onConnect, onSync, onDisconnect }: Props) {
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const working = status.phase === 'checking' || status.phase === 'downloading';

  const submit = async () => {
    setBusy(true);
    const ok = await onConnect(url);
    setBusy(false);
    if (ok) {
      setEditing(false);
      setUrl('');
    }
  };

  return (
    <section className="panel p-5">
      <PanelHeader
        icon={<Cloud className="w-4 h-4" />}
        title="Nuvem · Azure"
        aside={
          configured && (
            <div className="flex items-center gap-1">
              <button
                onClick={onSync}
                disabled={working}
                aria-label="Sincronizar agora"
                className="p-2 rounded-lg text-ink-muted hover:text-ink hover:bg-raised disabled:opacity-40 transition"
              >
                <RefreshCw className={`w-4 h-4 ${working ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={onDisconnect}
                aria-label="Desconectar a nuvem"
                className="p-2 rounded-lg text-ink-muted hover:text-ink hover:bg-raised transition"
              >
                <Unplug className="w-4 h-4" />
              </button>
            </div>
          )
        }
      />

      {!configured && !editing && (
        <div>
          <p className="text-xs text-ink-muted leading-relaxed mb-3">
            Guarde suas músicas num contêiner do Azure Blob Storage e o app baixa tudo sozinho, em qualquer aparelho.
          </p>
          <button
            onClick={() => setEditing(true)}
            className="w-full flex items-center justify-center gap-2 rounded-xl border border-line-strong bg-raised/60 text-xs font-medium py-2.5 text-ink hover:bg-raised transition"
          >
            <CloudDownload className="w-4 h-4 text-accent" /> Conectar armazenamento
          </button>
        </div>
      )}

      {!configured && editing && (
        <div className="space-y-2.5">
          <label htmlFor="sas" className="text-xs text-ink-muted">
            URL SAS do contêiner (permissões <b className="text-ink">Ler</b> e <b className="text-ink">Listar</b>)
          </label>
          <input
            id="sas"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://conta.blob.core.windows.net/musicas?sv=…"
            className="w-full rounded-xl bg-sunken border border-line-strong px-3 py-2.5 text-xs font-mono text-ink placeholder:text-ink-faint select-text focus:outline-none focus:border-accent"
          />
          <p className="text-[11px] text-ink-faint">Fica salva só neste aparelho.</p>
          <div className="flex gap-2">
            <button
              onClick={() => setEditing(false)}
              className="flex-1 rounded-xl border border-line text-xs py-2.5 text-ink-muted hover:text-ink transition"
            >
              Cancelar
            </button>
            <button
              onClick={submit}
              disabled={!url.trim() || busy}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-accent-strong text-white text-xs font-semibold py-2.5 disabled:opacity-40 transition"
            >
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Conectar
            </button>
          </div>
        </div>
      )}

      {configured && (
        <div className="rounded-xl bg-sunken/70 border border-line p-3">
          {status.phase === 'downloading' ? (
            <>
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="text-ink truncate pr-2">Baixando {status.current ?? '…'}</span>
                <span className="font-mono text-[11px] text-ink-muted tnum shrink-0">
                  {status.done}/{status.total}
                </span>
              </div>
              <div className="h-1 rounded-full bg-line-strong overflow-hidden">
                <div className="h-full bg-accent transition-all" style={{ width: `${(status.done / Math.max(1, status.total)) * 100}%` }} />
              </div>
            </>
          ) : status.phase === 'checking' ? (
            <p className="flex items-center gap-2 text-xs text-ink-muted">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Verificando a nuvem…
            </p>
          ) : status.phase === 'error' ? (
            <p className="flex items-start gap-2 text-xs text-warn">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {status.error}
            </p>
          ) : (
            <p className="flex items-center gap-2 text-xs text-ink-muted">
              <Check className="w-3.5 h-3.5 text-ok" />
              <span>
                <b className="text-ink font-medium">{status.cloudCount}</b> {status.cloudCount === 1 ? 'música sincronizada' : 'músicas sincronizadas'}
                {status.lastSync ? ` · ${timeAgo(status.lastSync)}` : ''}
                {status.failed ? ` · ${status.failed} com erro` : ''}
              </span>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
