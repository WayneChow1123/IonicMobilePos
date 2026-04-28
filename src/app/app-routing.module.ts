import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  { path: '', redirectTo: 'pages/home', pathMatch: 'full' },
  { path: 'pages/home', loadComponent: () => import('./pages/home/home.page').then(m => m.HomePage) },
  { path: 'pages/billing', loadComponent: () => import('./pages/billing/billing.page').then(m => m.BillingPage) },
  { path: 'pages/preferences', loadComponent: () => import('./pages/preferences/preferences.page').then(m => m.PreferencesPage) },
  { path: 'pages/invoices', loadComponent: () => import('./pages/invoices/invoices.page').then(m => m.InvoicesPage) },
  { path: 'pages/products', loadComponent: () => import('./pages/products/products.page').then(m => m.ProductsPage) },
  { path: 'pages/customers', loadComponent: () => import('./pages/customers/customers.page').then(m => m.CustomersPage) },
  { path: 'pages/customer-detail', loadComponent: () => import('./pages/customer-detail/customer-detail.page').then(m => m.CustomerDetailPage) },
  { path: 'pages/add-product', loadComponent: () => import('./pages/add-product/add-product.page').then(m => m.AddProductPage) },
  { path: 'pages/setting', loadComponent: () => import('./pages/setting/setting.page').then(m => m.SettingPage) },
  { path: 'pages/printer-setting', loadComponent: () => import('./pages/printer-setting/printer-setting.page').then(m => m.PrinterSettingPage) },
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })],
  exports: [RouterModule]
})
export class AppRoutingModule {}
