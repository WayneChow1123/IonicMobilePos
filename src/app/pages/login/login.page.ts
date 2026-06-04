import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, NavController } from '@ionic/angular';
import { AuthService } from '../../services/auth.service';
import { AlertService } from '../../services/alert.service';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
})
export class LoginPage {
  username = '';
  password = '';
  errorMessage = '';

  constructor(
    private authService: AuthService,
    private navCtrl: NavController,
    private alertService: AlertService
  ) {}

  async onSubmit() {
    if (this.authService.login(this.username, this.password)) {
      this.errorMessage = '';
      this.alertService.toast('Login successful!', 'success');
      this.navCtrl.navigateRoot('/pages/home');
    } else {
      this.errorMessage = 'INVALID USERNAME OR PASSWORD';
    }
  }
}
