import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

@Component({ standalone: true, imports: [CommonModule, IonicModule, FormsModule],
  selector: 'app-customer-detail',
  templateUrl: './customer-detail.page.html',
  styleUrls: ['./customer-detail.page.scss'],
})
export class CustomerDetailPage {
  constructor(private router: Router) {}
  goBack() { this.router.navigate(['pages/customers']); }
}
