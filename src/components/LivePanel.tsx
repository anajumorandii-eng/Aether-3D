import { useState } from 'react';
import { AlertCircle, AppWindow, AudioLines, Cable, Loader2, Unplug } from 'lucide-react';
import { canCaptureTab, canUseInputDevice, listInputDevices } from '../audio/liveInput';
import { PanelHeader } from './ui';

interface Props {
  liveLabel: string | null;
  /** Spotify connected with permission to read what is playing: enables timed DJ transitions. */
  spotifyLinked: boolean;
  busy: boolean;
  error: string | null;
  onTab: () => void;
  onDevice: (device: MediaDeviceInfo) => void;
  onStop: () => void;
}

const secondary = 'w-full flex items-center justify-center gap-2 rounded-md border border-line-strong bg-raised/60 text-xs font-medium py-2.5 text-ink hover:bg-raised disabled:opacity-40 transition';

/** Live sources for the computer: the Spotify web player in a tab, or a virtual cable. */
export function LivePanel({ liveLabel, spotifyLinked, busy, error, onTab, onDevice, onStop }: Props) {
  const [devices, setDevices] = useState<MediaDeviceInfo[] | null>(null);
  const [selected, setSelected] = useState('');
  const [listError, setListError] = useState<string | null>(null);
  const tab = canCaptureTab();
  const device = canUseInputDevice();
  if (!tab && !device) return null;

  const chooseDevice = async () => {
    setListError(null);
    try {
      const list = await listInputDevices();
      setDevices(list);
      setSelected(list[0]?.deviceId ?? '');
      if (list.length === 0) setListError('Nenhuma entrada de áudio encontrada.');
    } catch {
      setListError('Permita o acesso ao áudio para listar as entradas.');
    }
  };

  return (
    <section className="panel p-5">
      <PanelHeader
        icon={<AudioLines className="w-4 h-4" />}
        title="Ao vivo · Computador"
        aside={liveLabel && (
          <button onClick={onStop} aria-label="Parar captura ao vivo" className="p-2 rounded-lg text-ink-muted hover:text-ink hover:bg-raised transition">
            <Unplug className="w-4 h-4" />
          </button>
        )}
      />

      {liveLabel ? (
        <div className="rounded-md bg-sunken/70 border border-line p-3">
          <p className="flex items-center gap-2 text-xs text-ink-muted">
            <span className="w-1.5 h-1.5 rounded-full bg-ok animate-pulse shrink-0" />
            <span className="truncate">Tocando ao vivo: <b className="text-ink font-medium">{liveLabel}</b></span>
          </p>
          <p className="text-[11px] text-ink-faint mt-2">Controle a música no próprio Spotify. O som passa pelo motor do Aether, sem salvar arquivos.</p>
          <p className="text-[11px] text-ink-faint mt-2">{spotifyLinked ? 'Spotify conectado: as transições de DJ começam antes do fim de cada música.' : 'Conecte o Spotify e ative “Seguir o Spotify” uma vez (pode desligar depois) para as transições começarem antes do fim de cada música. Sem isso, elas acontecem quando a música nova começa.'}</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          <p className="text-xs text-ink-muted leading-relaxed">
            Ouça o Spotify pelo motor do Aether sem baixar as músicas.
          </p>
          {tab && (
            <button onClick={onTab} disabled={busy} className={secondary}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <AppWindow className="w-4 h-4 text-accent" />} Capturar aba do Spotify
            </button>
          )}
          {tab && <p className="text-[11px] text-ink-faint">Abra o open.spotify.com em outra aba, escolha essa aba e deixe “Compartilhar áudio da guia” marcado. O som original da aba fica mudo.</p>}
          {device && devices === null && (
            <button onClick={chooseDevice} disabled={busy} className={secondary}>
              <Cable className="w-4 h-4 text-accent" /> Usar uma entrada de áudio
            </button>
          )}
          {devices && devices.length > 0 && (
            <div className="space-y-2">
              <label htmlFor="live-device" className="text-xs text-ink-muted">Entrada de áudio</label>
              <select id="live-device" value={selected} onChange={e => setSelected(e.target.value)}
                className="w-full min-h-11 rounded-md bg-sunken border border-line-strong px-3 text-xs text-ink focus:outline-none focus:border-accent">
                {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Entrada sem nome'}</option>)}
              </select>
              <button onClick={() => { const d = devices.find(x => x.deviceId === selected); if (d) onDevice(d); }} disabled={busy || !selected}
                className="w-full flex items-center justify-center gap-2 rounded-md bg-accent-strong text-white text-xs font-semibold py-2.5 disabled:opacity-40 transition">
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Ouvir esta entrada
              </button>
            </div>
          )}
          {device && <p className="text-[11px] text-ink-faint">Para o app do Spotify: instale o VB-CABLE e, em Configurações do Windows › Sistema › Som › Mixer de volume, envie só o Spotify para “CABLE Input”. Depois escolha “CABLE Output” aqui.</p>}
        </div>
      )}

      {(error || listError) && (
        <p role="alert" className="flex items-start gap-2 text-xs text-warn mt-3">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error || listError}
        </p>
      )}
    </section>
  );
}
