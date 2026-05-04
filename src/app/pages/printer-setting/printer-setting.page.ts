import { Component, ChangeDetectorRef } from '@angular/core';
import { NavController } from '@ionic/angular';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';

@Component({
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule],
  selector: 'app-printer-setting',
  templateUrl: './printer-setting.page.html',
  styleUrls: ['./printer-setting.page.scss'],
})
export class PrinterSettingPage {
  paperWidth = 80;
  bottomEmptyLine = 5;

  interfaces = ['Bluetooth', 'USB', 'Network'];
  printerInterface = 'Bluetooth';
  printerType = 'JP Printer - Text';
  connectionType = 'Type 1-Normal';
  macAddress = '02:29:DE:43:D8:2C';

  formats = ['FORMAT 1', 'FORMAT 2', 'FORMAT 3'];
  selectedFormat = 'FORMAT 1';

  /** Per-format toggle presets */
  private formatPresets: Record<string, boolean[]> = {
    'FORMAT 1': [true, true, false, true, false, true, true, true, true, true, true, true],
    'FORMAT 2': [true, false, true, false, true, true, false, true, false, true, false, true],
    'FORMAT 3': [false, true, true, true, false, false, true, false, true, false, true, true],
  };

  private optionNames = [
    'Print Company Logo',
    'Print Issue Time',
    'Print Item Code',
    'Print Item U.O.M.',
    'Print Term Date',
    'Print Customer Tel',
    'Print Customer Add',
    'Sign on Cash Invoice',
    'Sign on Credit Invoice',
    'Sign on Credit Note',
    'Sign on Payment',
    'Footer',
  ];

  contentOptions = this.buildOptions('FORMAT 1');

  constructor(private router: Router, private navCtrl: NavController, private cdr: ChangeDetectorRef) {}

  ionViewWillEnter() {
    this.cdr.detectChanges();
  }

  goBack() {
    this.navCtrl.navigateRoot('pages/setting');
  }

  togglePaperWidth() {
    this.paperWidth = this.paperWidth === 80 ? 58 : 80;
  }

  refreshMac() {
    console.log('Refreshing MAC address...');
  }

  onFormatChange() {
    this.contentOptions = this.buildOptions(this.selectedFormat);
  }

  private buildOptions(format: string) {
    const flags = this.formatPresets[format] || this.formatPresets['FORMAT 1'];
    return this.optionNames.map((name, i) => ({ name, enabled: flags[i] }));
  }

  saveSettings() {
    console.log('Saving printer settings...', {
      paperWidth: this.paperWidth,
      bottomEmptyLine: this.bottomEmptyLine,
      printerInterface: this.printerInterface,
      printerType: this.printerType,
      connectionType: this.connectionType,
      macAddress: this.macAddress,
      selectedFormat: this.selectedFormat,
      contentOptions: this.contentOptions,
    });
  }
}
