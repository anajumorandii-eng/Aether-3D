import { useRef, useState } from 'react';
import type { useAccount } from '../account/useAccount';

export function AccountPanel({ account }: { account: ReturnType<typeof useAccount> }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const label = { connecting: 'Conectando à conta…', synced: 'Sincronizado', saving: 'Salvando alterações…', offline: 'Sem conexão. Os ajustes serão enviados ao reconectar.', error: 'Não foi possível sincronizar.' }[account.status];
  return <>
    <button onClick={() => { setOpen(true); dialog.current?.showModal(); }} disabled={account.loading} className="text-xs border border-line-strong rounded-md px-3 text-ink-muted hover:text-ink max-w-36 truncate" aria-label="Conta Aether">
      {account.loading ? 'Carregando…' : account.user ? account.user.displayName?.split(' ')[0] || 'Minha conta' : 'Entrar'}
    </button>
    <dialog ref={dialog} onClose={() => setOpen(false)} aria-labelledby="account-title" className="m-auto w-[min(440px,calc(100%-24px))] max-h-[90dvh] overflow-auto rounded-xl border border-line-strong bg-canvas text-ink p-5 backdrop:bg-black/70">
      {open && <>
        <div className="flex justify-between items-center gap-4 mb-4"><h2 id="account-title" className="text-lg font-semibold">Conta Aether</h2><button onClick={() => dialog.current?.close()} className="text-sm text-ink-muted px-2">Fechar</button></div>
        {account.user ? <>
          <p className="font-medium">{account.user.displayName || 'Minha conta'}</p><p className="text-sm text-ink-muted select-text break-all">{account.user.email}</p>
          <p role="status" className="text-sm text-accent mt-4">{label}</p>
          {account.status === 'error' && <button onClick={account.retry} className="text-sm underline text-accent">Tentar sincronizar novamente</button>}
          <p className="text-sm text-ink-muted leading-relaxed mt-3">Modos, ajustes de áudio, playlist escolhida e biblioteca na nuvem acompanham esta conta nos seus aparelhos. A última alteração em cada seção prevalece.</p>
          <p className="text-xs text-ink-muted leading-relaxed mt-3">Conecte o Spotify uma vez em cada aparelho. Arquivos importados, volume e reprodução permanecem neste dispositivo.</p>
          <button disabled={account.busy} onClick={account.logout} className="mt-5 w-full rounded-md border border-line-strong text-sm">{account.busy ? 'Saindo…' : 'Sair da conta'}</button>
        </> : <>
          <p className="text-sm text-ink-muted leading-relaxed">Entre com a mesma conta Google no iPhone e no iPad para sincronizar seus ajustes automaticamente.</p>
          <button disabled={account.busy || account.loading} onClick={account.login} className="mt-5 w-full rounded-md bg-white text-black text-sm font-medium disabled:opacity-50">{account.busy ? 'Abrindo Google…' : 'Entrar com Google'}</button>
          <p className="mt-3 text-xs text-ink-muted">O app continua disponível sem uma conta.</p>
        </>}
        {account.error && <p role="alert" className="mt-4 text-sm text-warn">{account.error}</p>}
      </>}
    </dialog>
  </>;
}
