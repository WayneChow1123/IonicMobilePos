import { Component, OnInit } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { NavController, Platform } from '@ionic/angular';
import { filter } from 'rxjs/operators';
import { App } from '@capacitor/app';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit {
  showBottomNav = false;
  activeIndex = 0;
  permissionBlocked = false;

  private navPages = [
    '/pages/home', 
    '/pages/billing', 
    '/pages/preferences', 
    '/pages/setting'
  ];

  constructor(
    private router: Router, 
    private navCtrl: NavController,
    private platform: Platform
  ) {
    // Initializing custom font size scaling from localStorage
    try {
      const savedFontSize = localStorage.getItem('pos-font-size');
      if (savedFontSize) {
        const val = parseInt(savedFontSize, 10);
        if (val >= 12 && val <= 24) {
          const scale = val / 16;
          (document.documentElement.style as any).zoom = scale.toString();
        }
      }
    } catch (e) {
      console.error('Error reading or applying font size scale:', e);
    }

    // Initializing dark theme from localStorage
    try {
      const isDarkMode = localStorage.getItem('pos-dark-mode') === 'true';
      if (isDarkMode) {
        document.body.classList.add('dark');
      } else {
        document.body.classList.remove('dark');
      }
    } catch (e) {
      console.error('Error reading or applying dark mode theme:', e);
    }

    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: any) => {
      const url = event.urlAfterRedirects.split('?')[0];
      
      if (this.navPages.includes(url)) {
        this.showBottomNav = true;
        if (url === '/pages/home') this.activeIndex = 0;
        else if (url === '/pages/billing') this.activeIndex = 1;
        else if (url === '/pages/preferences' || url === '/pages/setting') this.activeIndex = 2;
      } else {
        this.showBottomNav = false;
      }
    });
  }

  ngOnInit() {
    this.platform.ready().then(() => {
      this.checkAndRequestMandatoryPermissions();
      
      // When user returns from system Settings to the app, check permissions again
      App.addListener('appStateChange', (state) => {
        if (state.isActive) {
          this.checkAndRequestMandatoryPermissions(false);
        }
      });
    });
  }

  async checkAndRequestMandatoryPermissions(autoRequest = true) {
    if (!this.platform.is('cordova') && !this.platform.is('capacitor') && !(window as any).plugins?.permissions) {
      // In browser/dev mode, do not block
      return;
    }

    const permissionsPlugin = (window as any).plugins?.permissions;
    if (!permissionsPlugin) return;

    // Permissions to check: Location + Nearby Devices (BLUETOOTH_CONNECT & BLUETOOTH_SCAN)
    const requiredPermissions: string[] = [];
    
    if (permissionsPlugin.ACCESS_FINE_LOCATION) {
      requiredPermissions.push(permissionsPlugin.ACCESS_FINE_LOCATION);
    }
    if (permissionsPlugin.ACCESS_COARSE_LOCATION) {
      requiredPermissions.push(permissionsPlugin.ACCESS_COARSE_LOCATION);
    }
    if (permissionsPlugin.BLUETOOTH_CONNECT) {
      requiredPermissions.push(permissionsPlugin.BLUETOOTH_CONNECT);
    }
    if (permissionsPlugin.BLUETOOTH_SCAN) {
      requiredPermissions.push(permissionsPlugin.BLUETOOTH_SCAN);
    }

    if (requiredPermissions.length === 0) return;

    // Check which permissions are not yet granted
    const missingPermissions: string[] = [];

    for (const perm of requiredPermissions) {
      const granted = await new Promise<boolean>((resolve) => {
        permissionsPlugin.hasPermission(perm, (status: any) => {
          resolve(!!status?.hasPermission);
        }, () => {
          resolve(false);
        });
      });

      if (!granted) {
        missingPermissions.push(perm);
      }
    }

    if (missingPermissions.length === 0) {
      // All mandatory permissions are allowed!
      this.permissionBlocked = false;
      Swal.close();
      return;
    }

    if (autoRequest) {
      // Prompt user with native permission dialog
      permissionsPlugin.requestPermissions(
        missingPermissions,
        async (status: any) => {
          if (status && status.hasPermission) {
            // Re-verify all
            this.checkAndRequestMandatoryPermissions(false);
          } else {
            // Still denied
            this.permissionBlocked = true;
            this.showPermissionBlockedAlert();
          }
        },
        () => {
          this.permissionBlocked = true;
          this.showPermissionBlockedAlert();
        }
      );
    } else {
      this.permissionBlocked = true;
      this.showPermissionBlockedAlert();
    }
  }

  showPermissionBlockedAlert() {
    Swal.fire({
      icon: 'warning',
      title: 'Permissions Required',
      text: 'To use this Mobile POS app and connect to Bluetooth printers, you MUST allow "Location" and "Nearby Devices" permissions.',
      showCancelButton: true,
      confirmButtonText: 'Grant Permissions',
      cancelButtonText: 'Exit App',
      confirmButtonColor: '#5c85d6',
      cancelButtonColor: '#e74c3c',
      allowOutsideClick: false,
      allowEscapeKey: false,
      backdrop: `rgba(0, 0, 0, 0.85)`
    }).then((result) => {
      if (result.isConfirmed) {
        this.checkAndRequestMandatoryPermissions(true);
      } else {
        // Exit APK
        App.exitApp();
      }
    });
  }

  getSliderOffset(): number {
    const isTablet = window.innerWidth >= 768;
    const step = isTablet ? 108 : 56;
    return this.activeIndex * step;
  }

  goTo(page: string, index: number) {
    if (this.activeIndex === index && this.router.url.split('?')[0] === '/pages/' + page) return;
    this.activeIndex = index;
    this.navCtrl.navigateRoot('pages/' + page, { animated: false });
  }
}
