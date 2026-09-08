import { AlertService } from '../../services/alert.service';
import Swal from 'sweetalert2';
import { Component, ChangeDetectorRef, OnDestroy } from '@angular/core';
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
export class PrinterSettingPage implements OnDestroy {
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

  private scanSessionId = 0;
  private isScanning = false;
  private activeAlert: HTMLIonAlertElement | null = null;

  constructor(private router: Router, private navCtrl: NavController, private cdr: ChangeDetectorRef, private alertService: AlertService, private alertCtrl: AlertController) {}

  ionViewWillEnter() {
    this.loadSettings();
    this.cdr.detectChanges();
  }

  ngOnDestroy() {
    this.cleanupScanAndModals();
  }

  ionViewWillLeave() {
    this.cleanupScanAndModals();
  }

  private cleanupScanAndModals() {
    const bt = (window as any).bluetoothSerial;
    this.stopScanning(bt);
    if (Swal.isVisible()) {
      Swal.close();
    }
    if (this.activeAlert) {
      try {
        this.activeAlert.dismiss();
      } catch (e) {}
      this.activeAlert = null;
    }
  }

  private stopScanning(bt?: any) {
    this.scanSessionId++;
    this.isScanning = false;

    if (!bt) {
      bt = (window as any).bluetoothSerial;
    }

    if (bt) {
      if (typeof bt.clearDeviceDiscoveredListener === 'function') {
        try {
          bt.clearDeviceDiscoveredListener();
        } catch (e) {}
      }
      if (typeof bt.stopDiscover === 'function') {
        try {
          bt.stopDiscover();
        } catch (e) {}
      } else if (typeof (window as any).cordova?.exec === 'function') {
        try {
          (window as any).cordova.exec(null, null, 'BluetoothSerial', 'stopDiscover', []);
        } catch (e) {}
      }
    }
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

    // 1. Check if Bluetooth is turned on
    bt.isEnabled(
      () => {
        this.checkBluetoothPermissions(bt);
      },
      () => {
        // Bluetooth is OFF -> Prompt user via native system prompt to enable it
        bt.enable(
          () => {
            this.alertService.toast('Bluetooth enabled', 'success');
            this.checkBluetoothPermissions(bt);
          },
          () => {
            this.alertService.toast('Please turn on Bluetooth to scan for printers', 'warning');
          }
        );
      }
    );
  }

  private checkBluetoothPermissions(bt: any) {
    const permissions = (window as any).plugins?.permissions;
    if (!permissions) {
      this.quickListPairedDevices(bt);
      return;
    }

    const requiredPerms: string[] = [];
    if (permissions.BLUETOOTH_CONNECT) requiredPerms.push(permissions.BLUETOOTH_CONNECT);
    if (permissions.BLUETOOTH_SCAN) requiredPerms.push(permissions.BLUETOOTH_SCAN);
    if (permissions.ACCESS_FINE_LOCATION) requiredPerms.push(permissions.ACCESS_FINE_LOCATION);

    if (requiredPerms.length === 0) {
      this.quickListPairedDevices(bt);
      return;
    }

    permissions.requestPermissions(
      requiredPerms,
      (status: any) => {
        if (status && status.hasPermission) {
          this.quickListPairedDevices(bt);
        } else {
          this.alertService.toast('Bluetooth/Nearby Devices permission required to scan', 'error');
        }
      },
      () => {
        this.quickListPairedDevices(bt);
      }
    );
  }

  private quickListPairedDevices(bt: any) {
    // 1. Instant check: Retrieve paired devices from Android system cache (takes <0.05s)
    bt.list(
      (pairedDevices: any[]) => {
        const pairedList = Array.isArray(pairedDevices) ? pairedDevices : [];
        if (pairedList.length > 0) {
          // If paired devices exist, show dialog IMMEDIATELY with zero wait!
          this.presentDeviceSelection(pairedList, [], bt);
        } else {
          // If no paired devices, automatically start deep scan with progress
          this.startDeepScan(bt, []);
        }
      },
      () => {
        this.startDeepScan(bt, []);
      }
    );
  }

  private startDeepScan(bt: any, existingPaired: any[]) {
    // 1. Cancel and invalidate any previous scan session
    this.stopScanning(bt);

    const currentSession = ++this.scanSessionId;
    this.isScanning = true;
    const discoveredSoFar: any[] = [];

    // Register live listener so devices found are collected in real-time
    if (typeof bt.setDeviceDiscoveredListener === 'function') {
      bt.setDeviceDiscoveredListener((d: any) => {
        if (this.scanSessionId !== currentSession) return;
        if (d && (d.address || d.id)) {
          const mac = (d.address || d.id).toUpperCase();
          if (!discoveredSoFar.some(x => (x.address || x.id).toUpperCase() === mac)) {
            discoveredSoFar.push(d);
            const statusEl = document.getElementById('scan-status-text');
            if (statusEl) {
              statusEl.textContent = `Found ${discoveredSoFar.length} nearby device(s)...`;
            }
          }
        }
      });
    }

    Swal.fire({
      title: 'Scanning Nearby Printers...',
      html: `
        <div style="font-size: 14px; color: #555; margin-top: 8px; line-height: 1.6;">
          Searching in air for nearby Bluetooth devices...<br>
          <span id="scan-status-text" style="font-size: 13px; color: #2563eb; font-weight: 500;">
            Broadcasting for ~10 seconds...
          </span>
        </div>
      `,
      showDenyButton: true,
      showCancelButton: true,
      denyButtonText: 'Stop & Show List',
      cancelButtonText: 'Cancel',
      denyButtonColor: '#1a1a1a',
      cancelButtonColor: '#888',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading(Swal.getConfirmButton());
      }
    }).then((result) => {
      // If session changed before modal resolution, ignore
      if (this.scanSessionId !== currentSession) return;

      if (result.isDenied) {
        // User clicked "Stop & Show List" early!
        this.stopScanning(bt);
        this.presentDeviceSelection(existingPaired, discoveredSoFar, bt);
      } else if (result.dismiss === Swal.DismissReason.cancel || result.isDismissed) {
        // User clicked "Cancel" early!
        this.stopScanning(bt);
        // Do not open any popup or toast!
      }
    });

    bt.discoverUnpaired(
      (unpairedDevices: any[]) => {
        // CRITICAL: If scan was stopped, cancelled, or superseded, completely discard!
        if (this.scanSessionId !== currentSession) {
          return;
        }

        this.stopScanning(bt);
        if (Swal.isVisible()) {
          Swal.close();
        }

        const combined = (Array.isArray(unpairedDevices) && unpairedDevices.length > 0)
          ? unpairedDevices
          : discoveredSoFar;
        this.presentDeviceSelection(existingPaired, combined, bt);
      },
      (err: any) => {
        // CRITICAL: If scan was stopped, cancelled, or superseded, completely discard!
        if (this.scanSessionId !== currentSession) {
          return;
        }

        this.stopScanning(bt);
        if (Swal.isVisible()) {
          Swal.close();
        }

        if (existingPaired.length > 0 || discoveredSoFar.length > 0) {
          this.presentDeviceSelection(existingPaired, discoveredSoFar, bt);
        } else {
          this.alertService.toast('Scan error: ' + (err?.message || err), 'error');
        }
      }
    );
  }

  private async presentDeviceSelection(paired: any[], unpaired: any[], bt: any) {
    if (this.activeAlert) {
      try {
        await this.activeAlert.dismiss();
      } catch (e) {}
      this.activeAlert = null;
    }

    const seenMacs = new Set<string>();

    const uniquePaired: any[] = [];
    paired.forEach((d: any) => {
      const mac = (d.address || d.id || '').toUpperCase();
      if (mac && !seenMacs.has(mac)) {
        seenMacs.add(mac);
        uniquePaired.push(d);
      }
    });

    const uniqueUnpaired: any[] = [];
    unpaired.forEach((d: any) => {
      const mac = (d.address || d.id || '').toUpperCase();
      if (mac && !seenMacs.has(mac)) {
        seenMacs.add(mac);
        uniqueUnpaired.push(d);
      }
    });

    if (uniquePaired.length === 0 && uniqueUnpaired.length === 0) {
      this.alertService.toast('No Bluetooth devices found. Please ensure printer is turned on.', 'warning');
      return;
    }

    const inputs: any[] = [];

    // Add paired devices
    uniquePaired.forEach((d: any) => {
      const mac = d.address || d.id;
      inputs.push({
        type: 'radio' as const,
        label: `🔵 [Paired] ${d.name || 'Printer'} (${mac})`,
        value: mac,
        checked: mac === this.macAddress
      });
    });

    // Add discovered nearby unpaired devices
    uniqueUnpaired.forEach((d: any) => {
      const mac = d.address || d.id;
      inputs.push({
        type: 'radio' as const,
        label: `🟢 [Nearby] ${d.name || 'New Device'} (${mac})`,
        value: mac,
        checked: mac === this.macAddress
      });
    });

    const subText = uniqueUnpaired.length > 0
      ? `Found ${uniquePaired.length} paired, ${uniqueUnpaired.length} nearby`
      : `${uniquePaired.length} paired devices (Instant)`;

    const alert = await this.alertCtrl.create({
      header: 'Select Bluetooth Printer',
      subHeader: subText,
      inputs: inputs,
      buttons: [
        {
          text: '🔍 Scan Nearby',
          handler: () => {
            this.startDeepScan(bt, uniquePaired);
          }
        },
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

    this.activeAlert = alert;
    alert.onDidDismiss().then(() => {
      if (this.activeAlert === alert) {
        this.activeAlert = null;
      }
    });

    await alert.present();
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


