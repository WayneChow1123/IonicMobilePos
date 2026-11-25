import { Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';

export interface CompanyProfile {
  appName: string;
  companyName: string;
  address: string;
  city: string;
}
interface ProfileCache {
  profile: CompanyProfile;
  version: number;
  pending?: { profile: CompanyProfile; expectedVersion: number; operationId: string; attempted: boolean };
  conflict?: boolean;
}
const LEGACY_DEFAULT_PROFILE: CompanyProfile = {
  appName: 'TD Mobile POS', companyName: 'B JAYA TRADING',
  address: 'NO. 467, JALAN PALAS 13, TAMAN PELANGI,', city: '70400 SEREMBAN N.S, MALAYSIA'
};

const EMPTY_PROFILE: CompanyProfile = { appName: '', companyName: '', address: '', city: '' };

@Injectable({ providedIn: 'root' })
export class ProfileSettingsService {
  private readonly key = 'pos-company-profile-v2';
  private cache = this.load();
  private readonly state = signal<CompanyProfile>(this.cache.version > 0 ? this.cache.profile : { ...EMPTY_PROFILE });
  private readonly version = signal(this.cache.version);
  readonly profile = this.state.asReadonly();
  readonly serverVersion = this.version.asReadonly();
  readonly syncStatus = signal<'loading' | 'synced' | 'pending' | 'offline' | 'conflict' | 'local-only' | 'error'>(
    this.cache.conflict ? 'conflict' : this.cache.pending ? 'pending' : 'loading');
  readonly errorMessage = signal('');
  private inFlight?: Promise<void>;

  constructor(private api: ApiService) { this.startAutoRefresh(); }

  private startAutoRefresh(): void {
    void this.refresh();
    if (typeof window === 'undefined') return;
    window.addEventListener('online', () => void this.refresh());
    window.addEventListener('focus', () => void this.refresh());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void this.refresh(); });
    window.setInterval(() => { if (!document.hidden) void this.refresh(); }, 30000);
  }

  private normalize(value: any, allowEmpty = false): CompanyProfile {
    const result = { ...EMPTY_PROFILE };
    for (const key of Object.keys(result) as (keyof CompanyProfile)[]) {
      const text = typeof value?.[key] === 'string' ? value[key].trim() : '';
      const limit = key === 'appName' || key === 'companyName' ? 80 : 200;
      if ((!text && !allowEmpty) || text.length > limit || /[\u0000-\u001f\u007f]/.test(text)) throw new Error('Enter valid company profile fields.');
      result[key] = text;
    }
    return result;
  }

  private load(): ProfileCache {
    try {
      const saved = JSON.parse(localStorage.getItem(this.key) || 'null');
      if (saved && Number.isSafeInteger(saved.version) && saved.version >= 0) {
        saved.profile = this.normalize(saved.profile, saved.version === 0);
        if (saved.pending) saved.pending.profile = this.normalize(saved.pending.profile);
        return saved;
      }
      const legacy = JSON.parse(localStorage.getItem('pos-company-profile-v1') || 'null');
      return { profile: legacy ? this.normalize(legacy) : { ...EMPTY_PROFILE }, version: 0 };
    } catch { return { profile: { ...EMPTY_PROFILE }, version: 0 }; }
  }

  private persist(cache: ProfileCache): void {
    localStorage.setItem(this.key, JSON.stringify(cache));
    this.cache = cache;
  }

  private acceptServer(result: any): void {
    const profile = result?.version === 0 ? { ...EMPTY_PROFILE } : this.normalize(result);
    if (!Number.isSafeInteger(result.version) || result.version < 0) throw new Error('Invalid profile API response.');
    const cache = { profile, version: result.version };
    this.cache = cache;
    this.state.set(profile);
    this.version.set(result.version);
    this.syncStatus.set(result.version > 0 ? 'synced' : 'local-only');
    this.errorMessage.set('');
    try { this.persist(cache); }
    catch { this.errorMessage.set('Saved on API; this device could not update its offline cache.'); }
  }

  private isNetworkError(error: any): boolean {
    return error?.status === 0 || error?.status >= 500 || error?.name === 'TimeoutError';
  }

  private newOperationId(): string {
    return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : 'profile_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  }

  private async flush(): Promise<void> {
    if (!this.cache.pending || this.cache.conflict) return;
    const pending = { ...this.cache.pending, attempted: true };
    this.persist({ ...this.cache, pending });
    try {
      const result = await firstValueFrom(this.api.updateCompanyProfile(pending.profile, pending.expectedVersion, pending.operationId));
      if (result?.version !== pending.expectedVersion + 1 ||
          JSON.stringify(this.normalize(result)) !== JSON.stringify(pending.profile)) {
        this.syncStatus.set('pending');
        this.errorMessage.set('The API did not confirm the submitted company details. The displayed profile has not changed.');
        return;
      }
      this.acceptServer(result);
    } catch (error: any) {
      if (this.isNetworkError(error)) { this.syncStatus.set('pending'); return; }
      if (error?.status === 409) {
        this.persist({ ...this.cache, conflict: true });
        this.syncStatus.set('conflict');
        this.errorMessage.set('Company profile changed on another device. Reload the API profile before editing.');
      } else {
        const cache = { profile: this.cache.profile, version: this.cache.version };
        this.persist(cache);
        this.state.set(cache.version > 0 ? cache.profile : { ...EMPTY_PROFILE });
        this.syncStatus.set('error');
        this.errorMessage.set(error?.status === 404 ? 'Company Profile API is unavailable. Update the API first.' : 'The API rejected this profile. Changes were not saved on the server.');
      }
      throw new Error(this.errorMessage());
    }
  }

  refresh(discardPending = false): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      if (!this.api.isOnline()) { this.syncStatus.set(this.cache.conflict ? 'conflict' : this.cache.pending ? 'pending' : 'offline'); return; }
      try {
        if (!discardPending && this.cache.pending) { await this.flush(); return; }
        const result = await firstValueFrom(this.api.getCompanyProfile());
        // Validate the endpoint response before initiating any legacy migration.
        this.normalize(result, result?.version === 0);
        if (!Number.isSafeInteger(result.version) || result.version < 0) throw new Error('Invalid profile API response.');
        if (result.version === 0 && this.cache.version === 0 && !this.cache.pending &&
            JSON.stringify(this.cache.profile) !== JSON.stringify(LEGACY_DEFAULT_PROFILE) &&
            JSON.stringify(this.cache.profile) !== JSON.stringify(EMPTY_PROFILE) && !discardPending) {
          // Older APKs saved only locally. Publish that existing edit only when
          // the API confirms there is no configured profile; CAS protects a race
          // with another device. Persist first so restart/retry uses the same ID.
          this.persist({ ...this.cache, pending: { profile: this.cache.profile, expectedVersion: 0,
            operationId: this.newOperationId(), attempted: false }, conflict: false });
          this.syncStatus.set('pending');
          await this.flush();
          return;
        }
        const incoming = this.normalize(result, result.version === 0);
        if (!discardPending && this.cache.version > 0 && (
            result.version < this.cache.version ||
            (result.version === this.cache.version && JSON.stringify(incoming) !== JSON.stringify(this.cache.profile)))) {
          // A restored database or stale API response must not silently replace a
          // newer, confirmed device copy. Only an explicit reload accepts it.
          this.persist({ ...this.cache, conflict: true });
          this.syncStatus.set('conflict');
          this.errorMessage.set('The API returned an older or inconsistent company profile. Your saved address has been kept on this device. Check the server data before choosing Reload API Profile.');
          return;
        }
        this.acceptServer(result);
      } catch (error: any) {
        if (this.isNetworkError(error)) this.syncStatus.set(this.cache.pending ? 'pending' : 'offline');
        else if (this.syncStatus() !== 'conflict') {
          this.syncStatus.set('error');
          this.errorMessage.set(error?.message || 'Unable to load Company Profile from API.');
        }
      }
    })().finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }

  async save(value: CompanyProfile, expectedVersion = this.serverVersion()): Promise<boolean> {
    if (this.inFlight) await this.inFlight;
    if (this.cache.conflict) throw new Error(this.errorMessage() || 'Reload the API profile before editing.');
    if (this.cache.pending?.attempted) {
      await this.refresh();
      if (this.cache.pending) throw new Error('A previous save is awaiting API confirmation. Reconnect before editing again.');
    }
    if (!this.api.isOnline()) throw new Error('Connect to the internet to save company details to the API. Nothing was saved locally.');
    const profile = this.normalize(value);
    const operationId = this.newOperationId();
    this.persist({ ...this.cache, pending: { profile, expectedVersion, operationId, attempted: false }, conflict: false });
    this.syncStatus.set('pending');
    this.errorMessage.set('');
    if (this.api.isOnline()) await this.flush();
    if (this.syncStatus() !== 'synced') throw new Error('API confirmation is pending. Your displayed company details have not changed. Reconnect to confirm this save.');
    return true;
  }

  html(value: string): string {
    return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
  }
}
