import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { ApiService } from './api.service';
import { CompanyProfile, ProfileSettingsService } from './profile-settings.service';

describe('Company profile API synchronization', () => {
  let api: jasmine.SpyObj<ApiService>;
  let server: CompanyProfile & { version: number };
  const original = { appName: 'POS', companyName: 'Original Company', address: 'Road 1', city: 'City 1' };
  const changed = { appName: 'Shared POS', companyName: 'Shared Company', address: 'Road 2', city: 'City 2' };

  beforeEach(() => {
    localStorage.clear();
    spyOn<any>(ProfileSettingsService.prototype, 'startAutoRefresh').and.stub();
    server = { ...original, version: 1 };
    api = jasmine.createSpyObj('ApiService', ['isOnline', 'getCompanyProfile', 'updateCompanyProfile']);
    api.isOnline.and.returnValue(true);
    api.getCompanyProfile.and.callFake(() => of({ ...server }));
    api.updateCompanyProfile.and.callFake((value, version) => {
      if (version !== server.version) return throwError(() => new HttpErrorResponse({ status: 409 }));
      server = { ...value, version: version + 1 };
      return of({ ...server });
    });
  });

  it('only reports saved-to-API after the PUT succeeds', async () => {
    const profile = new ProfileSettingsService(api);
    await profile.refresh();
    expect(await profile.save(changed, 1)).toBeTrue();
    expect(api.updateCompanyProfile.calls.mostRecent().args.slice(0, 2)).toEqual([changed, 1]);
    expect(profile.syncStatus()).toBe('synced');
    expect(profile.serverVersion()).toBe(2);
    expect(server.companyName).toBe(changed.companyName);
  });

  it('refreshes another device cache from the shared server', async () => {
    const deviceA = new ProfileSettingsService(api);
    const deviceB = new ProfileSettingsService(api);
    await deviceA.refresh(); await deviceB.refresh();
    await deviceA.save(changed, 1);
    expect(deviceB.profile().companyName).toBe(original.companyName);
    await deviceB.refresh();
    expect(deviceB.profile()).toEqual(changed);
    expect(deviceB.serverVersion()).toBe(2);
  });

  it('persists offline changes as pending, then sends them after restart and reconnect', async () => {
    const first = new ProfileSettingsService(api);
    await first.refresh();
    api.isOnline.and.returnValue(false);
    expect(await first.save(changed, 1)).toBeFalse();
    expect(first.syncStatus()).toBe('pending');
    expect(api.updateCompanyProfile).not.toHaveBeenCalled();
    const restarted = new ProfileSettingsService(api);
    expect(restarted.profile()).toEqual(changed);
    expect(restarted.syncStatus()).toBe('pending');
    api.isOnline.and.returnValue(true);
    await restarted.refresh();
    expect(restarted.syncStatus()).toBe('synced');
    expect(server.companyName).toBe(changed.companyName);
  });

  it('retries an uncertain save using the same operation ID', async () => {
    const profile = new ProfileSettingsService(api);
    await profile.refresh();
    api.updateCompanyProfile.and.returnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    expect(await profile.save(changed, 1)).toBeFalse();
    const operationId = api.updateCompanyProfile.calls.mostRecent().args[2];
    api.updateCompanyProfile.and.returnValue(of({ ...changed, version: 2 }));
    await profile.refresh();
    expect(api.updateCompanyProfile.calls.mostRecent().args[2]).toBe(operationId);
    expect(profile.syncStatus()).toBe('synced');
  });

  it('rejects a missing old-server endpoint instead of showing save success', async () => {
    const profile = new ProfileSettingsService(api);
    await profile.refresh();
    api.updateCompanyProfile.and.returnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    await expectAsync(profile.save(changed, 1)).toBeRejected();
    expect(profile.syncStatus()).toBe('error');
    expect(profile.profile()).toEqual(original);
    expect(profile.errorMessage()).toContain('Update the API');
    expect(JSON.parse(localStorage.getItem('pos-company-profile-v2')!).pending).toBeUndefined();
  });

  it('requires a reload after a competing device changed the server version', async () => {
    const deviceA = new ProfileSettingsService(api);
    const deviceB = new ProfileSettingsService(api);
    await deviceA.refresh(); await deviceB.refresh();
    await deviceA.save(changed, 1);
    await expectAsync(deviceB.save({ ...original, companyName: 'Stale Edit' }, 1)).toBeRejected();
    expect(deviceB.syncStatus()).toBe('conflict');
    expect(server.companyName).toBe(changed.companyName);
    await deviceB.refresh(true);
    expect(deviceB.profile()).toEqual(changed);
    expect(await deviceB.save({ ...changed, city: 'New City' }, 2)).toBeTrue();
    expect(server.version).toBe(3);
  });

  it('does not silently publish a previous local-only profile when the server is not configured', async () => {
    localStorage.setItem('pos-company-profile-v1', JSON.stringify(changed));
    api.getCompanyProfile.and.returnValue(of({ ...original, version: 0 }));
    const profile = new ProfileSettingsService(api);
    await profile.refresh();
    expect(profile.profile()).toEqual(changed);
    expect(profile.syncStatus()).toBe('local-only');
    expect(api.updateCompanyProfile).not.toHaveBeenCalled();
  });

  it('loads an existing API profile in preference to legacy local settings', async () => {
    localStorage.setItem('pos-company-profile-v1', JSON.stringify(changed));
    const profile = new ProfileSettingsService(api);
    await profile.refresh();
    expect(profile.profile()).toEqual(original);
    expect(profile.syncStatus()).toBe('synced');
  });

  it('refuses invalid profile fields and an unpersistable offline save', async () => {
    const profile = new ProfileSettingsService(api);
    await profile.refresh();
    await expectAsync(profile.save({ ...changed, companyName: ' ' }, 1)).toBeRejected();
    api.isOnline.and.returnValue(false);
    spyOn(Storage.prototype, 'setItem').and.throwError('Quota exceeded');
    await expectAsync(profile.save(changed, 1)).toBeRejected();
    expect(profile.profile()).toEqual(original);
    expect(api.updateCompanyProfile).not.toHaveBeenCalled();
  });
});
