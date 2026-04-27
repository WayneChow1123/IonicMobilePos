import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

@Component({
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule],
  selector: 'app-preferences',
  templateUrl: './preferences.page.html',
  styleUrls: ['./preferences.page.scss'],
})
export class PreferencesPage {
  showToast = false;
  toastMessage = '';
  constructor(private router: Router, private api: ApiService) {}
  goTo(path: string) { this.router.navigate([path]); }
  goBack() { this.router.navigate(['pages/home']); }
  backupFull() {
    this.api.getFullBackup().subscribe({
      next: () => { this.toastMessage = 'Backup successful!'; this.showToast = true; },
      error: () => { this.toastMessage = 'Backup failed!'; this.showToast = true; }
    });
  }
  exportBills() {
    this.api.getBillReport().subscribe({
      next: () => { this.toastMessage = 'Export successful!'; this.showToast = true; },
      error: () => { this.toastMessage = 'Export failed!'; this.showToast = true; }
    });
  }
}
