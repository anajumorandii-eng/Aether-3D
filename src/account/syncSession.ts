import { onValue, ref, runTransaction, update, type Database } from 'firebase/database';
import { SETTINGS_KEYS, settingsDiff, validateSettings, type AccountSettings, type SettingsPatch } from './settings';

export type SyncStatus = 'connecting' | 'synced' | 'saving' | 'offline' | 'error';
export class SyncSession {
  private active = true;
  private ready = false;
  private connected = false;
  private pending: SettingsPatch = {};
  private current: AccountSettings;
  private baseline: AccountSettings;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private unsubscribers: (() => void)[] = [];
  private readonly key: string;
  private readonly target;
  constructor(db: Database, uid: string, initial: AccountSettings,
    private apply: (patch: SettingsPatch) => void,
    private status: (status: SyncStatus) => void) {
    this.target = ref(db, `users/${uid}/settings`);
    this.key = `aether_pending_${uid}`;
    this.current = initial;
    this.baseline = initial;
    try {
      const saved = JSON.parse(localStorage.getItem(this.key) ?? '{}') as SettingsPatch;
      const valid = validateSettings({ ...initial, ...saved });
      this.pending = settingsDiff(initial, valid);
    } catch { this.pending = {}; }
  }
  private persist() {
    if (Object.keys(this.pending).length) localStorage.setItem(this.key, JSON.stringify(this.pending));
    else localStorage.removeItem(this.key);
  }
  async start(db: Database) {
    this.status('connecting');
    try {
      const result = await runTransaction(this.target, existing => existing ?? this.current, { applyLocally: false });
      if (!this.active) return;
      this.baseline = validateSettings(result.snapshot.val());
      this.current = validateSettings({ ...this.baseline, ...this.pending });
      this.apply(this.current);
      this.ready = true;
      this.unsubscribers.push(onValue(this.target, snapshot => {
        if (!this.active || !snapshot.exists()) return;
        try {
          const next = validateSettings(snapshot.val());
          const patch = settingsDiff(this.baseline, next);
          this.baseline = next;
          // Preserve local unsent edits when another device changes a different section.
          for (const key of SETTINGS_KEYS) if (key in this.pending) delete patch[key];
          this.current = { ...this.current, ...patch };
          if (Object.keys(patch).length) this.apply(patch);
        } catch { this.status('error'); }
      }, () => this.status('error')));
      this.unsubscribers.push(onValue(ref(db, '.info/connected'), snapshot => {
        this.connected = snapshot.val() === true;
        if (!this.active) return;
        if (this.connected) void this.flush(); else this.status('offline');
      }));
    } catch { if (this.active) this.status('error'); }
  }
  queue(next: AccountSettings) {
    if (!this.active) return;
    const changes = settingsDiff(this.current, next);
    if (!Object.keys(changes).length) return;
    this.current = next;
    this.pending = { ...this.pending, ...changes };
    try { this.persist(); } catch { this.status('error'); }
    if (!this.ready) return;
    this.status(this.connected ? 'saving' : 'offline');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 500);
  }
  async flush() {
    if (!this.active || !this.ready) return;
    const sent = { ...this.pending };
    if (!Object.keys(sent).length) { this.status(this.connected ? 'synced' : 'offline'); return; }
    this.status(this.connected ? 'saving' : 'offline');
    try {
      await update(this.target, sent);
      if (!this.active) return;
      for (const key of SETTINGS_KEYS) if (this.pending[key] === sent[key]) delete this.pending[key];
      this.persist();
      this.status(Object.keys(this.pending).length ? 'saving' : this.connected ? 'synced' : 'offline');
    } catch { if (this.active) this.status('error'); }
  }
  stop() {
    this.active = false;
    clearTimeout(this.timer);
    this.unsubscribers.forEach(unsubscribe => unsubscribe());
  }
}
