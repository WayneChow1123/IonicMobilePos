import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

const routes: Routes = [
  { path: '', redirectTo: 'pages/home', pathMatch: 'full' },
  { path: 'login', loadComponent: () => import('./pages/login/login.page').then(m => m.LoginPage) },
  { path: 'pages/home', loadComponent: () => import('./pages/home/home.page').then(m => m.HomePage), canActivate: [authGuard] },
  { path: 'pages/billing', loadComponent: () => import('./pages/billing/billing.page').then(m => m.BillingPage), canActivate: [authGuard] },
  { path: 'pages/preferences', loadComponent: () => import('./pages/preferences/preferences.page').then(m => m.PreferencesPage), canActivate: [authGuard] },
  { path: 'pages/invoices', loadComponent: () => import('./pages/invoices/invoices.page').then(m => m.InvoicesPage), canActivate: [authGuard] },
  { path: 'pages/products', loadComponent: () => import('./pages/products/products.page').then(m => m.ProductsPage), canActivate: [authGuard] },
  { path: 'pages/customers', loadComponent: () => import('./pages/customers/customers.page').then(m => m.CustomersPage), canActivate: [authGuard] },
  { path: 'pages/customer-detail', loadComponent: () => import('./pages/customer-detail/customer-detail.page').then(m => m.CustomerDetailPage), canActivate: [authGuard] },
  { path: 'pages/add-product', loadComponent: () => import('./pages/add-product/add-product.page').then(m => m.AddProductPage), canActivate: [authGuard] },
  { path: 'pages/setting', loadComponent: () => import('./pages/setting/setting.page').then(m => m.SettingPage), canActivate: [authGuard] },
  { path: 'pages/printer-setting', loadComponent: () => import('./pages/printer-setting/printer-setting.page').then(m => m.PrinterSettingPage), canActivate: [authGuard] },
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })],
  exports: [RouterModule]
})
export class AppRoutingModule {}

