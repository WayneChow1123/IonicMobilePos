import { AlertService } from '../../services/alert.service';
import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { NavController } from '@ionic/angular';


import { Router, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AppComponent } from '../../app.component';
import { BluetoothPrintService } from '../../services/bluetooth-print.service';

@Component({
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule],
  selector: 'app-billing',
  templateUrl: './billing.page.html',
  styleUrls: ['./billing.page.scss'],
})
export class BillingPage implements OnInit {
  ionViewWillEnter() {
    this.currentView = 'home';
    this.loadCustomers();
    this.loadAllInvoices();
    this.cdr.detectChanges();
  }


  payments: any[] = [];
  filteredPayments: any[] = [];
  creditNotes: any[] = [];
  filteredCreditNotes: any[] = [];
  customers: any[] = [];
  invoices: any[] = [];
  isLoading = false;
  selectedPaymentDetail: any = null;
  printerSettings: any = null;
  showPaymentPreview = false;
  private _currentView = 'home';
  get currentView(): string {
    return this._currentView;
  }
  set currentView(value: string) {
    this._currentView = value;
    this.updateBottomNav();
  }

  updateBottomNav() {
    if (this.appComponent) {
      this.appComponent.showBottomNav = (this._currentView === 'home');
    }
  }
  showDeletePaymentAlert = false;
  showDeleteCNAlert = false;
  showStockAlert = false;
  showToast = false;
  toastMessage = '';
  selectedPayment: any = null;
  selectedCN: any = null;
  selectedInvoiceDetail: any = null;
  selectedCNInvoiceDetail: any = null;
  customerProductPrices: any[] = [];

  loadCustomerProductPrices(customerId: number) {
    if (!customerId) {
      this.customerProductPrices = [];
      return;
    }
    this.api.getCustomerProductPrices(customerId).subscribe({
      next: (res) => { this.customerProductPrices = Array.isArray(res) ? res : []; },
      error: () => { this.customerProductPrices = []; }
    });
  }

  getCustomerSpecialPrice(productId: any): number | null {
    if (!this.customerProductPrices || this.customerProductPrices.length === 0) return null;
    const special = this.customerProductPrices.find(p => p.productId == productId);
    return special ? special.specialPrice : null;
  }

  getOriginalUnitPrice(productId: any): number {
    const product = this.allProducts.find(p => p.id == productId);
    return product ? product.price : 0;
  }
  cnFilteredInvoices: any[] = [];
  stockIssues: any[] = [];
  pendingPayload: any = null;
  waitingInvoiceId: number | null = null;
  paymentSearchTerm = '';
  cnSearchTerm = '';
  paymentForm: any = { customerId: 0, invoiceIds: [], amount: 0, method: 'Cash', referenceNo: '' };
  cnForm: any = { customerId: 0, invoiceId: 0, reason: '', items: [] };
  paymentMethods = ['Cash', 'Card', 'Online Transfer', 'Cheque'];
  isFirstATMInput = true;
  
  showInvoiceSelectionModal = false;
  selectedInvoicesList: any[] = [];
  invoiceSearchTerm = '';
  filteredPaymentInvoices: any[] = [];

  deletePaymentButtons = [
    { text: 'Cancel', role: 'cancel' },
    { text: 'Delete', role: 'destructive', handler: () => this.deletePayment() }
  ];
  deleteCNButtons = [
    { text: 'Cancel', role: 'cancel' },
    { text: 'Delete', role: 'destructive', handler: () => this.deleteCreditNote() }
  ];

  showHistoryModal = false;
  purchaseHistory: any[] = [];
  filteredHistory: any[] = [];
  historySearchTerm = '';

  showProductModal = false;
  allProducts: any[] = [];
  filteredProductsSelection: any[] = [];
  productSearchTerm = '';

  getSelectedCustomerDiscount(): number {
    if (!this.cnForm.customerId) return 0;
    const customer = this.customers.find((c: any) => c.id == this.cnForm.customerId);
    return customer ? (customer.discountPercent || customer.discount || 0) : 0;
  }

  getDiscountedPrice(price: number): number {
    const discount = this.getSelectedCustomerDiscount();
    if (discount <= 0) return price;
    return Math.round(price * (1 - discount / 100) * 100) / 100;
  }

  loadAllProducts() {
    this.isLoading = true;
    this.api.getProducts().subscribe({
      next: (res: any) => {
        this.allProducts = res || [];
        this.filteredProductsSelection = [...this.allProducts];
        this.showProductModal = true;
        this.isLoading = false;
      },
      error: () => { this.isLoading = false; this.showToastMsg('Failed to load products'); }
    });
  }

  filterProductsForSelection() {
    const term = this.productSearchTerm.toLowerCase();
    this.filteredProductsSelection = this.allProducts.filter(p =>
      (p.name || '').toLowerCase().includes(term) ||
      (p.productCode || p.code || '').toLowerCase().includes(term)
    );
  }

  selectProduct(product: any) {
    this.showProductModal = false;

    // Check if item already exists in the list
    const found = this.cnForm.items.find((i: any) => i.productId === product.id);
    if (found) {
      found.returnQuantity += 1;
    } else {
      this.cnForm.items.push({
        productId: product.id,
        productName: product.name,
        maxQuantity: 9999, // Allow large return if selected from all products
        returnedQuantity: 0,
        returnQuantity: 0,
        returnToStock: false,
        isGlobal: true 
      });
    }
    
    // Force UI update
    this.cnForm.items = [...this.cnForm.items];
    this.showToastMsg(`Added ${product.name}`);
    this.cdr.detectChanges();
  }

  loadPurchaseHistory() {
    if (!this.cnForm.customerId || this.cnForm.customerId == 0) {
      this.showToastMsg('Please select a customer first');
      return;
    }
    this.isLoading = true;
    this.api.getCustomerPurchaseHistory(this.cnForm.customerId).subscribe({
      next: (res: any) => {
        this.purchaseHistory = res || [];
        this.filteredHistory = [...this.purchaseHistory];
        this.showHistoryModal = true;
        this.isLoading = false;
      },
      error: () => { this.isLoading = false; this.showToastMsg('Failed to load history'); }
    });
  }

  filterHistory() {
    const term = this.historySearchTerm.toLowerCase();
    this.filteredHistory = this.purchaseHistory.filter(h =>
      (h.productName || '').toLowerCase().includes(term) ||
      (h.invoiceNumber || '').toLowerCase().includes(term)
    );
  }

  selectHistoryItem(item: any) {
    this.cnForm.customerId = Number(item.customerId) || this.cnForm.customerId; 
    this.showHistoryModal = false;

    // Check if item already exists in the list
    const found = this.cnForm.items.find((i: any) => i.productId === item.productId);
    if (found) {
      found.returnQuantity += 1;
      if (found.returnQuantity > found.maxQuantity) found.returnQuantity = found.maxQuantity;
    } else {
      this.cnForm.items.push({
        productId: item.productId,
        productName: item.productName,
        maxQuantity: item.remaining, 
        returnedQuantity: item.totalReturned,
        returnQuantity: 0,
        returnToStock: false,
        isGlobal: true 
      });
    }
    
    // Force UI update
    this.cnForm.items = [...this.cnForm.items];
    this.showToastMsg(`Added ${item.productName} from history`);
    this.cdr.detectChanges();
  }

  constructor(
    private router: Router, 
    private route: ActivatedRoute, 
    private navCtrl: NavController, 
    private api: ApiService, 
    private cdr: ChangeDetectorRef, 
    private alertService: AlertService,
    private appComponent: AppComponent,
    private btPrint: BluetoothPrintService
  ) {}

  ionViewWillLeave() {
  }




  ngOnInit() { 
    this.loadCustomers(); 
    this.loadAllInvoices();

    this.route.queryParams.subscribe(params => {
      if (params['action'] === 'newCN') {
        const custId = Number(params['customerId']);
        const invId = Number(params['invoiceId']);
        
        // Short delay to ensure data is loaded
        setTimeout(() => {
          this.currentView = 'newCN';
          this.cnForm.customerId = custId;
          this.onCNCustomerChange();
          this.cnForm.invoiceId = invId;
          this.onCNInvoiceChange();
        }, 300);
      } else if (params['action'] === 'viewPayment') {
        const invNum = params['invoiceNumber'];
        this.isLoading = true;
        this.api.getPayments().subscribe({
          next: (res) => {
            this.payments = Array.isArray(res) ? res : [];
            this.filteredPayments = [...this.payments];
            
            const payment = this.payments.find((p: any) => p.invoiceNumber === invNum);
            if (payment) {
              this.viewPaymentDetails(payment);
            } else {
              this.showToastMsg('No payment record found for this invoice');
              this.openPaymentList();
            }
            this.isLoading = false;
          },
          error: () => {
            this.isLoading = false;
            this.showToastMsg('Failed to load payments');
          }
        });
      }
    });
  }

  loadCustomers() {
    this.api.getAllCustomers().subscribe({
      next: (res) => { this.customers = Array.isArray(res) ? res : []; },
      error: () => {}
    });
  }

  loadAllInvoices() {
    this.api.getInvoices({ _t: new Date().getTime() }).subscribe({
      next: (res) => { 
        this.invoices = Array.isArray(res) ? res : []; 
        this.cnFilteredInvoices = [...this.invoices];
      },
      error: () => {}
    });
  }

  paymentInvoices: any[] = [];

  loadInvoicesByCustomer(customerId: any) {
    const cid = Number(customerId);
    this.api.getInvoices({ customerId: cid, _t: new Date().getTime() }).subscribe({
      next: (res) => { 
        const list = Array.isArray(res) ? res : [];
        console.log('API returned invoices count:', list.length);
        this.paymentInvoices = list.filter((inv: any) => inv.status !== 'Paid');
        this.filteredPaymentInvoices = [...this.paymentInvoices];
        this.invoiceSearchTerm = '';
        console.log('Filtered invoices count:', this.paymentInvoices.length);
        this.cdr.detectChanges(); // Force UI update
      },
      error: (err) => { console.error('API Error:', err); }
    });
  }

  loadPayments() {
    this.isLoading = true;
    this.api.getPayments().subscribe({
      next: (res) => { this.payments = Array.isArray(res) ? res : []; this.filteredPayments = [...this.payments]; this.isLoading = false; },
      error: () => { this.isLoading = false; }
    });
  }

  loadCreditNotes() {
    this.isLoading = true;
    this.api.getAllCreditNotes().subscribe({
      next: (res) => { this.creditNotes = Array.isArray(res) ? res : []; this.filteredCreditNotes = [...this.creditNotes]; this.isLoading = false; },
      error: () => { this.isLoading = false; }
    });
  }

  filterPayments() {
    this.filteredPayments = this.payments.filter(p =>
      (p.customerName || '').toLowerCase().includes(this.paymentSearchTerm.toLowerCase()) ||
      (p.invoiceNumber || '').toLowerCase().includes(this.paymentSearchTerm.toLowerCase()) ||
      (p.referenceNo || '').toLowerCase().includes(this.paymentSearchTerm.toLowerCase())
    );
  }

  filterCreditNotes() {
    this.filteredCreditNotes = this.creditNotes.filter(cn =>
      (cn.cnNumber || '').toLowerCase().includes(this.cnSearchTerm.toLowerCase()) ||
      (cn.invoiceNumber || '').toLowerCase().includes(this.cnSearchTerm.toLowerCase()) ||
      (cn.customerName || '').toLowerCase().includes(this.cnSearchTerm.toLowerCase()) ||
      (cn.reason || '').toLowerCase().includes(this.cnSearchTerm.toLowerCase())
    );
  }

  goHome() { this.currentView = 'home'; }

  openNewPayment() {
    this.paymentForm = { customerId: this.customers.length > 0 ? this.customers[0].id : 0, invoiceIds: [], amount: 0, method: 'Cash', referenceNo: '' };
    this.selectedInvoicesList = [];
    if (this.customers.length > 0) this.loadInvoicesByCustomer(this.customers[0].id);
    this.currentView = 'newPayment';
  }

  openInvoiceModal() {
    if (!this.paymentForm.customerId || this.paymentForm.customerId === 0) {
      this.showToastMsg('Please select a customer first');
      return;
    }
    this.invoiceSearchTerm = '';
    this.loadInvoicesByCustomer(this.paymentForm.customerId);
    this.currentView = 'selectInvoices';
    this.cdr.detectChanges();
  }

  filterInvoicesForSelection() {
    const term = this.invoiceSearchTerm.trim().toLowerCase();
    if (!term) {
      this.filteredPaymentInvoices = [...this.paymentInvoices];
    } else {
      this.filteredPaymentInvoices = this.paymentInvoices.filter(inv =>
        (inv.invoiceNumber || '').toLowerCase().includes(term)
      );
    }
    this.cdr.detectChanges();
  }

  openNewCN() {
    this.loadAllInvoices();
    this.cnForm = { customerId: 0, invoiceId: 0, reason: '', items: [] };
    this.cnFilteredInvoices = [...this.invoices];
    this.selectedCNInvoiceDetail = null;
    this.currentView = 'newCN';
  }

  openPaymentList() { this.paymentSearchTerm = ''; this.loadPayments(); this.currentView = 'paymentList'; }
  viewPaymentDetails(payment: any) {
    this.showPaymentPreview = false;
    this.isLoading = true;
    if (!this.allProducts || this.allProducts.length === 0) {
      this.api.getProducts().subscribe({ next: (res: any) => { this.allProducts = res || []; } });
    }
    this.api.getPaymentPreview(payment.id).subscribe({
      next: (res: any) => {
        this.selectedPaymentDetail = res;
        this.currentView = 'paymentDetails';
        this.isLoading = false;
      },
      error: (err: any) => {
        this.isLoading = false;
        this.showToastMsg('Failed to load payment details: ' + (err.error?.message || err.message || 'error'));
      }
    });
  }

  loadPrinterSettings() {
    const saved = localStorage.getItem('printerSettings');
    if (saved) {
      try {
        this.printerSettings = JSON.parse(saved);
      } catch (e) {
        console.error(e);
      }
    }
    if (!this.printerSettings) {
      this.printerSettings = {
        paperWidth: 80,
        bottomEmptyLine: 5,
        contentOptions: [
          { name: 'Print Company Logo', enabled: true },
          { name: 'Print Issue Time', enabled: true },
          { name: 'Print Item Code', enabled: false },
          { name: 'Print Item U.O.M.', enabled: true },
          { name: 'Print Term Date', enabled: false },
          { name: 'Print Customer Tel', enabled: true },
          { name: 'Print Customer Add', enabled: true },
          { name: 'Sign on Cash Invoice', enabled: true },
          { name: 'Sign on Credit Invoice', enabled: true },
          { name: 'Sign on Credit Note', enabled: true },
          { name: 'Sign on Payment', enabled: true },
          { name: 'Footer', enabled: true },
          { name: 'Print Product Barcode', enabled: false }
        ]
      };
    }
  }

  isOptionEnabled(optionName: string): boolean {
    this.loadPrinterSettings();
    if (!this.printerSettings || !this.printerSettings.contentOptions) return true;
    const opt = this.printerSettings.contentOptions.find((o: any) => o.name === optionName);
    return opt ? opt.enabled : true;
  }

  getProductCode(productId: any): string {
    if (!this.allProducts) return '';
    const product = this.allProducts.find(p => p.id == productId);
    return product?.productCode || product?.code || '';
  }

  getProductBarcode(productId: any): string {
    if (!this.allProducts) return '';
    const product = this.allProducts.find(p => p.id == productId);
    return product?.barcode || '';
  }

  printPaymentReceipt() {
    this.loadPrinterSettings();
    if (this.printerSettings?.printerInterface === 'Bluetooth' && this.btPrint.isAvailable()) {
      this.btPrint.printPayment(this.selectedPaymentDetail, this.printerSettings, this.customers, this.allProducts);
      return;
    }
    
    let iframe = document.getElementById('print-iframe') as HTMLIFrameElement;
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = 'print-iframe';
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);
    }
    const printWindow = iframe.contentWindow || (iframe.contentDocument as any)?.defaultView;
    if (!printWindow) { this.showToastMsg('Failed to initialize print iframe'); return; }

    const width = this.printerSettings?.paperWidth === 58 ? '360px' : '480px';
    const styles = `<style>* { margin: 0; padding: 0; box-sizing: border-box; } body { font-family: 'Courier New', monospace; background: #F0EBE3; display: flex; justify-content: center; padding: 40px 20px; } .receipt { background: #fff; border-radius: 24px; padding: 40px 36px; max-width: ${width}; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,0.08); } .receipt-type { display: block; text-align: center; font-size: 13px; letter-spacing: 6px; color: #888; margin-bottom: 16px; } .divider { height: 1px; background: #1a1a1a; margin: 12px 0; } .divider-thin { height: 1px; background: #ddd; margin: 12px 0; } .company { text-align: center; font-size: 22px; font-weight: 700; margin: 12px 0 4px; } .co-reg { display: block; text-align: center; font-size: 12px; color: #888; margin-bottom: 8px; } .address { display: block; text-align: center; font-size: 11px; color: #666; line-height: 1.6; } .contact { display: block; text-align: center; font-size: 11px; color: #888; margin-top: 6px; } .doc-row { display: flex; gap: 12px; margin: 4px 0; } .doc-label { font-size: 12px; font-weight: 700; min-width: 70px; } .doc-value { font-size: 12px; font-weight: 700; } .to-section { margin: 16px 0; } .to-label { font-size: 12px; font-style: italic; color: #888; } .to-box { border: 1px solid #ddd; border-radius: 8px; padding: 12px; margin-top: 6px; font-size: 12px; line-height: 1.6; } .table-header { display: flex; justify-content: space-between; font-size: 11px; font-weight: 700; font-style: italic; } .item-row { margin: 12px 0; } .item-desc { display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; } .item-calc { font-size: 11px; color: #888; margin-top: 2px; display: flex; justify-content: space-between; } .total-row { display: flex; justify-content: space-between; font-size: 12px; margin: 4px 0; } .net-bar { background: #1a1a1a; color: #fff; border-radius: 8px; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; margin: 16px 0; } .net-label { font-size: 12px; font-weight: 700; font-style: italic; } .net-value { font-size: 20px; font-weight: 700; } .due-box { border: 1px solid #ddd; border-radius: 8px; padding: 16px; text-align: center; margin: 16px 0; } .due-label { display: block; font-size: 10px; letter-spacing: 3px; color: #888; margin-bottom: 6px; } .due-date { font-size: 18px; font-weight: 700; } .sig-box { border: 1px solid #ddd; border-radius: 8px; padding: 16px; min-height: 100px; margin: 16px 0; } .sig-label { font-size: 11px; color: #ccc; font-style: italic; } .thanks { text-align: center; font-size: 12px; letter-spacing: 6px; color: #ccc; margin-top: 20px; }</style>`;

    const pd = this.selectedPaymentDetail;
    if (!pd) return;

    // Company Header
    let companyHeaderHtml = '';
    if (this.isOptionEnabled('Print Company Logo')) {
      companyHeaderHtml = `
        <div class="company">B JAYA TRADING</div>
        <span class="co-reg">(001188861-T)</span>
        <span class="address">NO. 467, JALAN PALAS 13, TAMAN PELANGI,</span>
        <span class="address">70400 SEREMBAN N.S, SEREMBAN, N.S, MALAYSIA</span>
        <span class="contact">TEL: 012-6988080</span>
      `;
    }

    // Date
    let dateHtml = '';
    const payDate = pd.paymentDate ? new Date(pd.paymentDate) : new Date();
    const dateStr = payDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    if (this.isOptionEnabled('Print Issue Time')) {
      dateHtml = `<div class="doc-row"><span class="doc-label">DATE</span><span class="doc-value">: ${dateStr}</span></div>`;
    }

    // Customer
    let customerBoxHtml = '';
    if (this.isOptionEnabled('Print Customer Tel') || this.isOptionEnabled('Print Customer Add')) {
      customerBoxHtml = `
        <div class="to-section">
          <span class="to-label">CUSTOMER:</span>
          <div class="to-box">
            <strong>${pd.customer?.name}</strong>
            ${this.isOptionEnabled('Print Customer Tel') && pd.customer?.phone ? `<div style="margin-top: 4px; font-weight:bold;">TEL: ${pd.customer?.phone}</div>` : ''}
          </div>
        </div>
      `;
    }

    // Invoice items table
    let itemsHtml = '';
    const items = pd.invoice?.items || [];
    items.forEach((item: any, i: number) => {
      const subtotal = item.total.toFixed(2);
      itemsHtml += `<div class="item-row"><div class="item-desc"><span>${i + 1}. ${item.productName}</span></div><div class="item-calc"><span>${item.quantity} x ${(item.unitPrice || 0).toFixed(2)}</span><span>${subtotal}</span></div></div>`;
    });

    const receiptNumber = pd.receiptNumber || `RCPT-${pd.id}`;
    const invoiceNumber = pd.invoice?.invoiceNumber || '';
    
    const paymentDetailHtml = `<div style="padding:12px 20px;border:1px dashed #ddd;border-radius:8px;margin-bottom:16px;background:#fcfcfc;">
        <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;padding:3px 0;"><span>PAYMENT METHOD</span><span style="text-transform:uppercase;">${pd.paymentMethod}</span></div>
        ${pd.referenceNo ? `<div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;padding:3px 0;"><span>REFERENCE NO</span><span>${pd.referenceNo}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;padding:3px 0;border-top:1px dashed #eee;margin-top:6px;padding-top:6px;"><span>INVOICE TOTAL</span><span>RM ${(pd.invoice?.totalAmount || 0).toFixed(2)}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;padding:3px 0;"><span>INVOICE BALANCE</span><span>RM ${(pd.invoice?.balance || 0).toFixed(2)}</span></div>
    </div>`;

    let sigBoxHtml = '';
    if (this.isOptionEnabled('Sign on Payment')) {
      sigBoxHtml = `<div class="sig-box"><span class="sig-label">PAYMENT RECEIVED SIGNATURE</span></div>`;
    }
    
    let footerHtml = '';
    if (this.isOptionEnabled('Footer')) {
      footerHtml = `<div class="thanks">THANK YOU</div>`;
    }

    let emptyLinesHtml = '';
    const linesCount = this.printerSettings?.bottomEmptyLine ?? 5;
    for (let l = 0; l < linesCount; l++) {
      emptyLinesHtml += `<div style="height: 20px;"></div>`;
    }

    printWindow.document.write(`<!DOCTYPE html><html><head><title>Receipt ${receiptNumber}</title>${styles}</head><body><div class="receipt"><span class="receipt-type">OFFICIAL RECEIPT</span><div class="divider"></div>${companyHeaderHtml}<div style="margin-top:20px;"><div class="doc-row"><span class="doc-label">RECEIPT NO</span><span class="doc-value">: ${receiptNumber}</span></div><div class="doc-row"><span class="doc-label">INVOICE NO</span><span class="doc-value">: ${invoiceNumber}</span></div>${dateHtml}</div>${customerBoxHtml}<div class="divider-thin"></div><div class="table-header"><span>DESCRIPTION</span><span>SUBTOTAL</span></div><div class="divider-thin"></div>${itemsHtml}<div class="divider-thin"></div>${paymentDetailHtml}<div class="net-bar"><span class="net-label">PAYMENT RECEIVED</span><span class="net-value">RM ${pd.paymentAmount.toFixed(2)}</span></div>${sigBoxHtml}${footerHtml}${emptyLinesHtml}</div></body></html>`);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  }

  openCNList() { this.cnSearchTerm = ''; this.loadCreditNotes(); this.currentView = 'cnList'; }

  onCustomerChange() {
    if (this.paymentForm.customerId) {
      this.loadInvoicesByCustomer(this.paymentForm.customerId);
      this.paymentForm.invoiceIds = [];
      this.selectedInvoicesList = [];
    }
  }

  onInvoiceChange() {
    // Legacy onInvoiceChange not needed for multiple selection.
  }

  onCNCustomerChange() {
    this.cnForm.invoiceId = 0;
    this.cnForm.items = [];
    this.selectedCNInvoiceDetail = null;
    if (this.cnForm.customerId && this.cnForm.customerId != 0) {
      this.cnFilteredInvoices = this.invoices.filter((inv: any) => inv.customerId == this.cnForm.customerId);
      this.loadCustomerProductPrices(Number(this.cnForm.customerId));
    } else {
      this.cnFilteredInvoices = [...this.invoices];
      this.customerProductPrices = [];
    }
  }

  onCNInvoiceChange() {
    if (this.cnForm.invoiceId && this.cnForm.invoiceId != 0) {
      this.api.getInvoiceDetails(Number(this.cnForm.invoiceId)).subscribe({
        next: (res: any) => {
          this.selectedCNInvoiceDetail = res;
          // ✅ 双重保险：优先取顶层 customerId，取不到就取 res.customer.id
          const cid = res.customerId || (res.customer ? res.customer.id : 0);
          this.cnForm.customerId = Number(cid); 
          this.loadCustomerProductPrices(Number(cid));
          this.cnForm.items = [];
          if (res.items && res.items.length > 0) {
            res.items.forEach((item: any) => {
              const remainingQty = item.quantity - (item.returnedQuantity || 0);
              if (remainingQty > 0) {
                this.cnForm.items.push({
                  productId: item.productId,
                  productName: item.productName,
                  maxQuantity: remainingQty,
                  returnedQuantity: item.returnedQuantity || 0,
                  returnQuantity: 0,
                  returnToStock: false
                });
              }
            });
          }
        },
        error: () => { this.selectedCNInvoiceDetail = null; }
      });
    } else {
      this.selectedCNInvoiceDetail = null;
    }
  }

  toggleInvoiceSelection(inv: any) {
    const idx = this.paymentForm.invoiceIds.indexOf(inv.id);
    if (idx > -1) {
      this.paymentForm.invoiceIds.splice(idx, 1);
      this.selectedInvoicesList = this.selectedInvoicesList.filter((i: any) => i.id !== inv.id);
    } else {
      this.paymentForm.invoiceIds.push(inv.id);
      this.selectedInvoicesList.push(inv);
    }
  }

  isInvoiceSelected(inv: any): boolean {
    return this.paymentForm.invoiceIds.includes(inv.id);
  }

  hasStandardCN(inv: any): boolean {
    const cnTotal = inv.CNTotal ?? inv.cnTotal ?? 0;
    return cnTotal > 0.01;
  }

  getStandardCNDeduction(inv: any): number {
    return inv.CNTotal ?? inv.cnTotal ?? 0;
  }

  getInvoiceCreditUsed(inv: any): number {
    return inv.CreditUsed ?? inv.creditUsed ?? 0;
  }

  confirmInvoiceSelection() {
    this.currentView = 'newPayment';
    this.paymentForm.amount = this.getBulkBalance();
    this.isFirstATMInput = true;
  }

  handleATMInput(event: any) {
    const key = event.key;
    
    // Allow Tab and Enter to pass through without blocking
    if (key === 'Tab' || key === 'Enter') {
      return;
    }
    
    // Prevent default typing/navigation behavior for numbers, Backspace, and other characters
    event.preventDefault();
    
    const balance = this.getBulkBalance();
    let digits = '';
    
    if (this.isFirstATMInput && key >= '0' && key <= '9') {
      this.isFirstATMInput = false;
      digits = key;
    } else {
      if (key >= '0' && key <= '9') {
        this.isFirstATMInput = false;
      }
      
      let currentCents = Math.round((this.paymentForm.amount || 0) * 100);
      let centsStr = currentCents.toString();
      if (centsStr === '0' || centsStr === 'NaN') {
        centsStr = '';
      }
      
      if (key >= '0' && key <= '9') {
        centsStr += key;
      } else if (key === 'Backspace') {
        centsStr = centsStr.slice(0, -1);
      } else {
        return; // Ignore other keys
      }
      digits = centsStr;
    }
    
    const rawVal = digits ? parseInt(digits, 10) : 0;
    let newVal = rawVal / 100;
    
    if (newVal > balance) {
      newVal = balance;
    }
    
    this.paymentForm.amount = newVal;
  }

  getBulkTotalAmount(): number {
    return this.selectedInvoicesList.reduce((sum, inv) => sum + (inv.totalAmount ?? inv.TotalAmount ?? 0), 0);
  }

  getBulkPaidAmount(): number {
    return this.selectedInvoicesList.reduce((sum, inv) => sum + (inv.paidAmount ?? inv.PaidAmount ?? 0), 0);
  }

  getBulkCreditNotes(): number {
    return this.selectedInvoicesList.reduce((sum, inv) => sum + (inv.CNTotal ?? inv.cnTotal ?? 0), 0);
  }

  getBulkCreditUsed(): number {
    return this.selectedInvoicesList.reduce((sum, inv) => sum + (inv.CreditUsed ?? inv.creditUsed ?? 0), 0);
  }

  getBulkBalance(): number {
    return this.selectedInvoicesList.reduce((sum, inv) => sum + (inv.Balance ?? inv.balance ?? 0), 0);
  }

  useCreditNote(cn: any) {
    if (cn.isUsed) return;
    this.api.useCreditNote(Number(cn.invoiceId), Number(cn.id)).subscribe({
      next: (res: any) => {
        const applied = (res.creditApplied || 0).toFixed(2);
        const remaining = (res.cnRemainingAmount || 0).toFixed(2);
        const invoice = res.appliedToInvoice || '';
        const fullyUsed = res.cnFullyUsed;

        if (fullyUsed) {
          this.showToastMsg(`RM ${applied} credit applied to ${invoice}. CN fully used.`);
        } else {
          this.showToastMsg(`RM ${applied} applied to ${invoice}. CN remaining: RM ${remaining}`);
        }
        this.loadCreditNotes();
      },
      error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.message || 'error'))
    });
  }

  getPaymentAmountValidationError(): string | null {
    if (!this.paymentForm.invoiceIds || this.paymentForm.invoiceIds.length === 0) {
      return 'Please select at least one invoice';
    }
    const balance = this.getBulkBalance();
    const amount = Number(this.paymentForm.amount);
    
    if (isNaN(amount) || amount <= 0) {
      return 'Amount must be greater than 0';
    }
    
    if (amount > balance) {
      return `Amount cannot exceed the balance due: RM ${balance.toFixed(2)}`;
    }
    
    return null;
  }

  getPaymentChange(): number {
    const balance = this.getBulkBalance();
    const amount = Number(this.paymentForm.amount);
    if (!amount || amount <= balance) return 0;
    return amount - balance;
  }

  savePayment() {
    if (!this.paymentForm.customerId) { this.showToastMsg('Please select a customer'); return; }
    
    const errorMsg = this.getPaymentAmountValidationError();
    if (errorMsg) { this.showToastMsg(errorMsg); return; }
    
    const totalInputAmount = Number(this.paymentForm.amount);

    // Distribute payment — each invoice gets at most its own balance
    let remainingAmount = totalInputAmount;
    const payments = [];
    
    // Sort invoices oldest first based on invoiceDate
    const sortedInvoices = [...this.selectedInvoicesList].sort((a, b) => {
      const dateA = new Date(a.invoiceDate || 0).getTime();
      const dateB = new Date(b.invoiceDate || 0).getTime();
      return dateA - dateB;
    });

    for (const inv of sortedInvoices) {
      if (remainingAmount <= 0) break;
      const invBalance = inv.balance ?? inv.Balance ?? 0;
      const amountToApply = Math.min(remainingAmount, invBalance);
      if (amountToApply > 0) {
        payments.push({
          invoiceId: inv.id,
          amount: amountToApply
        });
        remainingAmount -= amountToApply;
      }
    }

    if (payments.length === 0) {
      this.showToastMsg('Could not distribute payment amount to selected invoices.'); return;
    }

    const payload = {
      customerId: Number(this.paymentForm.customerId),
      method: this.paymentForm.method,
      referenceNo: this.paymentForm.referenceNo || '',
      totalInputAmount: totalInputAmount,   // ← backend uses this to compute CN-CHG excess
      payments: payments
    };

    const excess = this.getPaymentChange();
    const successMsg = excess > 0.01
      ? `Payment recorded! Excess RM ${excess.toFixed(2)} converted to Credit Note.`
      : 'Bulk Payment created successfully!';

    this.api.createBulkPayment(payload).subscribe({
      next: () => { this.showToastMsg(successMsg); this.openPaymentList(); },
      error: (err: any) => {
        const errBody = err.error;
        this.showToastMsg('Failed: ' + (errBody?.message || errBody || err.message || 'error'));
      }
    });
  }

  adjustInvoiceToStock() {
    this.showStockAlert = false;
    this.navCtrl.navigateRoot('pages/invoices');
    this.showToastMsg('Please edit the invoice to match available stock');
  }

  deleteInvoiceFromStock() {
    if (!this.pendingPayload) return;
    this.showStockAlert = false;
    this.api.deleteInvoice(this.pendingPayload.invoiceId).subscribe({
      next: () => { this.showToastMsg('Invoice deleted!'); this.goHome(); },
      error: () => this.showToastMsg('Failed to delete invoice')
    });
  }

  ignoreStockIssue() {
    if (this.pendingPayload) {
      this.waitingInvoiceId = this.pendingPayload.invoiceId;
      const waiting = JSON.parse(localStorage.getItem('waitingInvoices') || '[]');
      if (!waiting.includes(this.pendingPayload.invoiceId)) {
        waiting.push(this.pendingPayload.invoiceId);
        localStorage.setItem('waitingInvoices', JSON.stringify(waiting));
      }
    }
    this.showStockAlert = false;
    this.showToastMsg('Invoice marked as waiting for stock');
  }

  saveCreditNote() {
    if (!this.cnForm.customerId || this.cnForm.customerId == 0) {
      // If no customer selected, try to get from items
      if (this.cnForm.items.length > 0) {
        // Already set in selectHistoryItem
      } else {
        this.showToastMsg('Please select a customer'); return; 
      }
    }
    
    if (!this.cnForm.reason) { this.showToastMsg('Please enter reason'); return; }
    
    const itemsToReturn = this.cnForm.items.filter((i: any) => i.returnQuantity > 0);
    if (itemsToReturn.length === 0) {
      this.showToastMsg('Please select at least one item to return');
      return;
    }

    for (const item of itemsToReturn) {
      if (Number(item.returnQuantity) > item.maxQuantity) {
        this.showToastMsg(`Cannot return ${item.returnQuantity} units of ${item.productName}. Only ${item.maxQuantity} remaining.`);
        return;
      }
    }

    const payloadItems = itemsToReturn.map((i: any) => ({
      productId: i.productId,
      quantity: Number(i.returnQuantity),
      returnToStock: i.returnToStock
    }));

    const payload = { reason: this.cnForm.reason, items: payloadItems };

    // ✅ 智能切换：如果列表里有来自“历史记录”的商品，或者根本没选发票，就走全局接口
    const hasGlobalItems = itemsToReturn.some((i: any) => i.isGlobal);
    const useGlobalMode = !this.cnForm.invoiceId || this.cnForm.invoiceId == 0 || hasGlobalItems;

    if (!useGlobalMode) {
      // 纯单号模式：所有商品都来自当前选中的发票
      this.api.createCreditNote(Number(this.cnForm.invoiceId), payload).subscribe({
        next: () => { this.showToastMsg('Credit Note created!'); this.openCNList(); },
        error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.error || err.message || 'error'))
      });
    } else {
      // 智能全局模式：支持跨单退货
      const payloadGlobal = { 
        reason: this.cnForm.reason, 
        items: payloadItems, 
        isManual: true,
        preferredInvoiceId: this.cnForm.invoiceId && this.cnForm.invoiceId != 0 ? Number(this.cnForm.invoiceId) : null
      };
      const cid = this.cnForm.customerId || (this.selectedCNInvoiceDetail?.customerId) || 0;
      if (!cid || cid == 0) { this.showToastMsg('Customer ID is required for global return'); return; }

      this.api.createGlobalCreditNote(Number(cid), payloadGlobal).subscribe({
        next: () => { this.showToastMsg('Global Credit Note created successfully!'); this.openCNList(); },
        error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.error || err.message || 'error'))
      });
    }
  }

  confirmDeletePayment(payment: any) { this.selectedPayment = payment; this.alertService.confirm('Delete Payment', 'Are you sure?').then(c => { if(c) this.deletePayment(); }); }
  deletePayment() {
    if (!this.selectedPayment) return;
    this.api.deletePayment(this.selectedPayment.id).subscribe({
      next: () => { this.showToastMsg('Payment deleted!'); this.loadPayments(); },
      error: (err: any) => this.showToastMsg('Failed: ' + (err.error || err.message || 'error'))
    });
  }

  confirmDeleteCN(cn: any) {
    if (cn.isUsed) { this.showToastMsg('This credit note has been used and cannot be deleted'); return; }
    this.selectedCN = cn;
    this.alertService.confirm('Delete Credit Note', 'Are you sure?').then(c => { if(c) this.deleteCreditNote(); });
  }
  deleteCreditNote() {
    if (!this.selectedCN) return;
    this.api.deleteCreditNote(Number(this.selectedCN.invoiceId), Number(this.selectedCN.id)).subscribe({
      next: () => { this.showToastMsg('Credit Note deleted!'); this.loadCreditNotes(); },
      error: (err: any) => this.showToastMsg('Failed: ' + (err.error || err.message || 'error'))
    });
  }

  noLeadingZero(event: KeyboardEvent, val: any) {
    if ((val === 0 || val === '' || val === null || val === undefined) && event.key === '0') {
      event.preventDefault();
    }
  }

  showToastMsg(msg: string) { const isWarn = msg.toLowerCase().includes('please') || msg.toLowerCase().includes('must') || msg.toLowerCase().includes('cannot') || msg.toLowerCase().includes('required') || msg.toLowerCase().includes('no '); const isErr = msg.toLowerCase().includes('fail') || msg.toLowerCase().includes('error'); this.alertService.toast(msg, isErr ? 'error' : (isWarn ? 'warning' : 'success')); }
  goTo(path: string, params?: any) { 
    if (params) {
      this.navCtrl.navigateRoot(path, { queryParams: params }); 
    } else {
      this.navCtrl.navigateRoot(path); 
    }
  }

  goBack() { this.navCtrl.navigateRoot('pages/home'); }
}



