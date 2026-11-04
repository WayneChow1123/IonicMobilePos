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

  editProfile() {
    this.profileDraft = { ...this.profileSettings.profile() };
    this.editingProfile = true;
  }

  saveProfile() {
    try {
      this.profileSettings.save(this.profileDraft);
      this.editingProfile = false;
      this.alertService.toast('Profile saved successfully!', 'success');
    } catch {
      this.alertService.toast('Unable to save. Check all fields and device storage.', 'error');
    }
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
