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
    '/pages/billing', 
    '/pages/preferences', 
    '/pages/setting'
  ];

  constructor(private router: Router, private navCtrl: NavController) {
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
