import { Component } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { NavController } from '@ionic/angular';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent {
  showBottomNav = false;
  activeIndex = 0;

  private navPages = [
    '/pages/home', 
    '/pages/preferences', 
    '/pages/setting'
  ];

  constructor(private router: Router, private navCtrl: NavController) {
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
        else if (url === '/pages/preferences' || url === '/pages/setting') this.activeIndex = 2;
      } else {
        this.showBottomNav = false;
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
