import { AlertService } from '../../services/alert.service';
import { Component, ChangeDetectorRef } from '@angular/core';
import { NavController, AlertController } from '@ionic/angular';
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
    'FORMAT 1': [true, true, false, true, false, true, true, true, true, true, true, true, false],
    'FORMAT 2': [true, false, true, false, true, true, false, true, false, true, false, true, false],
    'FORMAT 3': [false, true, true, true, false, false, true, false, true, false, true, true, false],
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
    'Print Product Barcode',
  ];

  contentOptions = this.buildOptions('FORMAT 1');

  constructor(private router: Router, private navCtrl: NavController, private cdr: ChangeDetectorRef, private alertService: AlertService, private alertCtrl: AlertController) {}

  ionViewWillEnter() {
    this.loadSettings();
    this.cdr.detectChanges();
  }

  loadSettings() {
    const saved = localStorage.getItem('printerSettings');
    if (saved) {
      try {
        const config = JSON.parse(saved);
        this.paperWidth = config.paperWidth ?? 80;
        this.bottomEmptyLine = config.bottomEmptyLine ?? 5;
        this.printerInterface = config.printerInterface ?? 'Bluetooth';
        this.printerType = config.printerType ?? 'JP Printer - Text';
        this.connectionType = config.connectionType ?? 'Type 1-Normal';
        this.macAddress = config.macAddress ?? '02:29:DE:43:D8:2C';
        this.selectedFormat = config.selectedFormat ?? 'FORMAT 1';
        if (config.contentOptions) {
          this.contentOptions = config.contentOptions;
        } else {
          this.contentOptions = this.buildOptions(this.selectedFormat);
        }
      } catch (e) {
        console.error('Error loading printer settings', e);
      }
    }
  }

  goBack() {
    this.navCtrl.navigateRoot('pages/setting');
  }

  togglePaperWidth() {
    this.paperWidth = this.paperWidth === 80 ? 58 : 80;
  }

  refreshMac() {
    const bt = (window as any).bluetoothSerial;
    if (!bt) {
      this.alertService.toast('Bluetooth serial plugin not available (only works on APK)', 'error');
      return;
    }

    const permissions = (window as any).plugins?.permissions;
    if (permissions && permissions.BLUETOOTH_CONNECT) {
      permissions.hasPermission(permissions.BLUETOOTH_CONNECT, (status: any) => {
        if (status.hasPermission) {
          this.listBtDevices(bt);
        } else {
          permissions.requestPermission(permissions.BLUETOOTH_CONNECT, (s: any) => {
            if (s.hasPermission) {
              this.listBtDevices(bt);
            } else {
              this.alertService.toast('Permission denied. Please enable "Nearby Devices" permission in App settings.', 'error');
            }
          }, () => {
            this.alertService.toast('Failed to request bluetooth permission', 'error');
          });
        }
      }, () => {
        this.alertService.toast('Failed to check bluetooth permission', 'error');
      });
    } else {
      this.listBtDevices(bt);
    }
  }

  private listBtDevices(bt: any) {
    this.alertService.toast('Scanning paired devices...', 'info');
    bt.list(
      async (devices: any[]) => {
        if (!devices || devices.length === 0) {
          this.alertService.toast('No paired Bluetooth devices found. Please pair in system settings first.', 'warning');
          return;
        }

        const inputs = devices.map((d: any) => ({
          type: 'radio' as const,
          label: `${d.name || 'Unnamed'} (${d.address || d.id})`,
          value: d.address || d.id,
          checked: d.address === this.macAddress || d.id === this.macAddress
        }));

        const alert = await this.alertCtrl.create({
          header: 'Select Bluetooth Printer',
          inputs: inputs,
          buttons: [
            { text: 'Cancel', role: 'cancel' },
            {
              text: 'Select',
              handler: (selectedMac) => {
                if (selectedMac) {
                  this.macAddress = selectedMac;
                  this.cdr.detectChanges();
                  this.alertService.toast(`Selected: ${selectedMac}`, 'success');
                }
              }
            }
          ]
        });

        await alert.present();
      },
      (err: any) => {
        this.alertService.toast('Failed to list bluetooth devices: ' + err, 'error');
      }
    );
  }

  onFormatChange() {
    this.contentOptions = this.buildOptions(this.selectedFormat);
  }

  private buildOptions(format: string) {
    const flags = this.formatPresets[format] || this.formatPresets['FORMAT 1'];
    return this.optionNames.map((name, i) => ({ name, enabled: flags[i] }));
  }

  saveSettings() {
    const config = {
      paperWidth: this.paperWidth,
      bottomEmptyLine: this.bottomEmptyLine,
      printerInterface: this.printerInterface,
      printerType: this.printerType,
      connectionType: this.connectionType,
      macAddress: this.macAddress,
      selectedFormat: this.selectedFormat,
      contentOptions: this.contentOptions,
    };
    localStorage.setItem('printerSettings', JSON.stringify(config));
    this.alertService.toast('Printer settings saved successfully!', 'success');
  }
}


