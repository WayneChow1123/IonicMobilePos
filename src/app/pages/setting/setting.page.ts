import { Component } from '@angular/core';
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

  constructor(private router: Router) {}

  goBack() {
    this.router.navigate(['pages/preferences']);
  }

  toggleDeviceAutoBlocking() {
    this.deviceAutoBlocking = !this.deviceAutoBlocking;
  }

  toggleTrainingMode() {
    this.trainingMode = !this.trainingMode;
  }

  navigateTo(section: string) {
    this.router.navigate(['pages/' + section]);
  }
}
