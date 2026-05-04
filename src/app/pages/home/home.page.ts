import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { NavController } from '@ionic/angular';


import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

@Component({
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule],
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
})
export class HomePage implements OnInit {
  totalCustomers = 0;
  totalProducts = 0;

  constructor(private router: Router, private navCtrl: NavController, private api: ApiService, private cdr: ChangeDetectorRef) {}



  ionViewWillEnter() {
    this.cdr.detectChanges();
  }


  ngOnInit() {
    this.api.getAllCustomers().subscribe({ next: (res) => { this.totalCustomers = Array.isArray(res) ? res.length : 0; }, error: () => {} });
    this.api.getProducts().subscribe({ next: (res) => { this.totalProducts = Array.isArray(res) ? res.length : 0; }, error: () => {} });
  }

  goTo(path: string) { this.navCtrl.navigateRoot(path); }

}
