import { Component, ChangeDetectorRef } from '@angular/core';
import { NavController } from '@ionic/angular';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

@Component({
  standalone: true,
  imports: [CommonModule, IonicModule],
  selector: 'app-setting',
  templateUrl: './setting.page.html',
  styleUrls: ['./setting.page.scss'],
})
export class SettingPage {
  deviceAutoBlocking = false;
  trainingMode = false;

  constructor(private router: Router, private navCtrl: NavController, private cdr: ChangeDetectorRef) {}

  ionViewWillEnter() {
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
}
