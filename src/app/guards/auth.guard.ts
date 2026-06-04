import { inject } from '@angular/core';
import { NavController } from '@ionic/angular';
import { AuthService } from '../services/auth.service';

export const authGuard = () => {
  const authService = inject(AuthService);
  const navCtrl = inject(NavController);

  if (authService.isLoggedIn()) {
    return true;
  }

  navCtrl.navigateRoot('/login');
  return false;
};
