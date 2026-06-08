import { Component, ChangeDetectorRef } from '@angular/core';
import { NavController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';

@Component({
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule],
  selector: 'app-configuration',
  templateUrl: './configuration.page.html',
  styleUrls: ['./configuration.page.scss'],
})
export class ConfigurationPage {
  fontSizeValue = 16;
  isDarkMode = false;

  constructor(
    private navCtrl: NavController,
    private cdr: ChangeDetectorRef
  ) {}

  ionViewWillEnter() {
    const savedFontSize = localStorage.getItem('pos-font-size');
    if (savedFontSize) {
      this.fontSizeValue = parseInt(savedFontSize, 10);
    } else {
      this.fontSizeValue = 16;
    }

    this.isDarkMode = localStorage.getItem('pos-dark-mode') === 'true';
    this.cdr.detectChanges();
  }

  goBack() {
    this.navCtrl.navigateRoot('pages/setting');
  }

  getFontSizeLabel(): string {
    if (this.fontSizeValue <= 12) return 'Tiny';
    if (this.fontSizeValue <= 14) return 'Small';
    if (this.fontSizeValue <= 16) return 'Normal';
    if (this.fontSizeValue <= 18) return 'Medium';
    if (this.fontSizeValue <= 20) return 'Large';
    if (this.fontSizeValue <= 22) return 'Extra Large';
    return 'Huge';
  }

  onFontSizeChange(event: any) {
    const value = event.detail.value;
    if (value !== undefined && value !== null) {
      this.fontSizeValue = value;
      localStorage.setItem('pos-font-size', this.fontSizeValue.toString());
      
      // Calculate and apply zoom scale immediately
      const scale = this.fontSizeValue / 16;
      (document.documentElement.style as any).zoom = scale.toString();
    }
  }

  toggleDarkMode() {
    this.isDarkMode = !this.isDarkMode;
    localStorage.setItem('pos-dark-mode', this.isDarkMode ? 'true' : 'false');
    if (this.isDarkMode) {
      document.body.classList.add('dark');
    } else {
      document.body.classList.remove('dark');
    }
  }
}
