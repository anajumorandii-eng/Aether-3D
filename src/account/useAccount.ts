import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, database, loginGoogle, logoutAccount } from './firebase';
import { SyncSession, type SyncStatus } from './syncSession';
import type { AccountSettings, SettingsPatch } from './settings';

export function useAccount(local: AccountSettings, apply: (patch: SettingsPatch) => void) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const [status, setStatus] = useState<SyncStatus>('connecting');
  const latest = useRef(local); latest.current = local;
  const applyRef = useRef(apply); applyRef.current = apply;
  const guest = useRef(local);
  const uid = useRef<string | null>(null);
  const session = useRef<SyncSession | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = onAuthStateChanged(auth, next => {
      const nextId = next?.uid ?? null;
      if (uid.current !== nextId) {
        session.current?.stop(); session.current = null;
        if (uid.current) { latest.current = guest.current; applyRef.current(guest.current); }
        if (nextId && !uid.current) guest.current = latest.current;
        uid.current = nextId;
      }
      setUser(next); setLoading(false); setError('');
    }, () => { setLoading(false); setError('Não foi possível verificar sua conta.'); });
    return () => { mounted.current = false; unsubscribe(); session.current?.stop(); };
  }, []);
  useEffect(() => {
    if (!user) return;
    const sync = new SyncSession(database, user.uid, latest.current, patch => {
      latest.current = { ...latest.current, ...patch };
      applyRef.current(patch);
    }, next => { if (mounted.current) setStatus(next); });
    session.current = sync;
    void sync.start(database);
    return () => { sync.stop(); if (session.current === sync) session.current = null; };
  }, [user?.uid, retryCount]);
  useEffect(() => { session.current?.queue(local); }, [local.sound, local.customModes, local.spotify, local.cloudUrl]);
  async function login() {
    setError(''); setBusy(true);
    try { await loginGoogle(); }
    catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') setError(
        code === 'auth/popup-blocked' ? 'Permita a janela de login do Google e tente novamente.' :
        code === 'auth/network-request-failed' ? 'Sem conexão com o Google. Tente novamente.' :
        'Não foi possível entrar com Google. Tente novamente.');
    } finally { if (mounted.current) setBusy(false); }
  }
  async function logout() {
    setError(''); setBusy(true);
    try { await logoutAccount(); }
    catch { setError('Não foi possível sair. Tente novamente.'); }
    finally { if (mounted.current) setBusy(false); }
  }
  return { user, loading, busy, error, status, login, logout, retry: () => setRetryCount(n => n + 1) };
}
