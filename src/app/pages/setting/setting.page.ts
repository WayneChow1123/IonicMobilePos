import { inject } from '@angular/core';
import { ProfileSettingsService } from '../../services/profile-settings.service';
﻿import { AlertService } from '../../services/alert.service';
import { Component, ChangeDetectorRef } from '@angular/core';
import { NavController } from '@ionic/angular';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { AuthService } from '../../services/auth.service';
import { FormsModule } from '@angular/forms';

@Component({
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule],
  selector: 'app-setting',
  templateUrl: './setting.page.html',
  styleUrls: ['./setting.page.scss'],
})
export class SettingPage {
  readonly profileSettings = inject(ProfileSettingsService);
  editingProfile = false;
  profileDraft = { ...this.profileSettings.profile() };
  isSavingProfile = false;
  private profileEditVersion = 0;

  editProfile() {
    this.profileDraft = { ...this.profileSettings.profile() };
    this.profileEditVersion = this.profileSettings.serverVersion();
    this.editingProfile = true;
  }

  async saveProfile() {
    if (this.isSavingProfile) return;
    this.isSavingProfile = true;
    try {
      const synced = await this.profileSettings.save(this.profileDraft, this.profileEditVersion);
      this.editingProfile = false;
      this.alertService.toast(synced ? 'Profile saved to API successfully!' : 'Profile saved on device. Waiting to sync with API.', synced ? 'success' : 'warning');
    } catch (error: any) {
      this.alertService.toast(error?.message || 'Unable to save company profile.', 'error');
    } finally {
      this.isSavingProfile = false;
      this.cdr.detectChanges();
    }
  }

  get profileStatusText(): string {
    const status = this.profileSettings.syncStatus();
    return {
      loading: 'Loading company profile from API...',
      synced: 'Saved to API. Shared across your devices.',
      pending: 'Pending API sync. Other devices will update after syncing.',
      offline: 'Offline: showing the last profile available on this device.',
      conflict: 'Another device changed this profile. Reload before editing.',
      'local-only': 'Not saved to API yet. Edit and Save to publish these company details.',
      error: 'Unable to load or save the company profile through API.'
    }[status];
  }

  async reloadProfile() {
    await this.profileSettings.refresh(true);
    if (this.profileSettings.syncStatus() === 'synced') this.editingProfile = false;
    this.cdr.detectChanges();
  }
  deviceAutoBlocking = false;
  trainingMode = false;
  isDarkMode = false;

  constructor(
    private router: Router,
    private navCtrl: NavController,
    private cdr: ChangeDetectorRef,
    private alertService: AlertService,
    private authService: AuthService
  ) {}

  ionViewWillEnter() {
    this.editingProfile = false;
    void this.profileSettings.refresh();
    try {
      this.isDarkMode = localStorage.getItem('pos-dark-mode') === 'true';
    } catch (e) {}
    this.cdr.detectChanges();
  }

  toggleDarkMode() {
    this.isDarkMode = !this.isDarkMode;
    try {
      localStorage.setItem('pos-dark-mode', this.isDarkMode ? 'true' : 'false');
    } catch (e) {}
    if (this.isDarkMode) {
      document.body.classList.add('dark');
    } else {
      document.body.classList.remove('dark');
    }
    this.cdr.detectChanges();
  }

  goBack() {
    this.navCtrl.navigateRoot('pages/preferences');
  }

  toggleDeviceAutoBlocking() {
    this.deviceAutoBlocking = !this.deviceAutoBlocking;
  }

  toggleTrainingMode() {
    this.trainingMode = !this.trainingMode;
  }

  navigateTo(section: string) {
    this.navCtrl.navigateRoot('pages/' + section);
  }

  logout() {
    this.authService.logout();
    this.alertService.toast('Logout successful!', 'success');
    this.navCtrl.navigateRoot('login');
  }
}
