import { Injectable, signal } from '@angular/core';

export interface CompanyProfile {
  appName: string;
  companyName: string;
  address: string;
  city: string;
}

const DEFAULT_PROFILE: CompanyProfile = {
  appName: 'TD Mobile POS',
  companyName: 'B JAYA TRADING',
  address: 'NO. 467, JALAN PALAS 13, TAMAN PELANGI,',
  city: '70400 SEREMBAN N.S, MALAYSIA'
};

@Injectable({ providedIn: 'root' })
export class ProfileSettingsService {
  private readonly key = 'pos-company-profile-v1';
  private readonly state = signal<CompanyProfile>(this.load());
  readonly profile = this.state.asReadonly();

  private load(): CompanyProfile {
    try {
      const saved = JSON.parse(localStorage.getItem(this.key) || '{}');
      const profile = { ...DEFAULT_PROFILE };
      for (const key of Object.keys(profile) as (keyof CompanyProfile)[]) {
        if (typeof saved?.[key] === 'string' && saved[key].trim()) {
          profile[key] = saved[key].trim();
        }
      }
      return profile;
    } catch {
      return { ...DEFAULT_PROFILE };
    }
  }

  save(value: CompanyProfile): void {
    const profile = { ...value };
    for (const key of Object.keys(DEFAULT_PROFILE) as (keyof CompanyProfile)[]) {
      profile[key] = profile[key].trim();
      const limit = key === 'appName' || key === 'companyName' ? 80 : 200;
      if (!profile[key] || profile[key].length > limit || /[\u0000-\u001f\u007f]/.test(profile[key])) {
        throw new Error('Invalid profile field');
      }
    }
    // Publish only after storage succeeds, so a failed save cannot look successful.
    localStorage.setItem(this.key, JSON.stringify(profile));
    this.state.set(profile);
  }

  html(value: string): string {
    return value.replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]!));
  }
}
