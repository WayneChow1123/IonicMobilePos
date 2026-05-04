import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { NavController } from '@ionic/angular';


import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Component({
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule],
  selector: 'app-preferences',
  templateUrl: './preferences.page.html',
  styleUrls: ['./preferences.page.scss'],
})
export class PreferencesPage implements OnInit {
  ionViewWillEnter() {
    this.showExportModal = false;
    this.cdr.detectChanges();
  }

  showToast = false;
  toastMessage = '';
  showExportModal = false;
  isLoading = false;
  exportType = 'all';
  customers: any[] = [];
  invoices: any[] = [];
  filteredInvoices: any[] = [];
  selectedCustomerId = '';
  selectedInvoiceId = '';
  searchTerm = '';

  constructor(private router: Router, private navCtrl: NavController, private api: ApiService, private cdr: ChangeDetectorRef) {}




  ngOnInit() { this.loadCustomers(); this.loadInvoices(); }

  loadCustomers() {
    this.api.getAllCustomers().subscribe({
      next: (res) => { this.customers = Array.isArray(res) ? res : []; },
      error: () => {}
    });
  }

  loadInvoices() {
    this.api.getInvoices().subscribe({
      next: (res) => { this.invoices = Array.isArray(res) ? res : []; this.filteredInvoices = [...this.invoices]; },
      error: () => {}
    });
  }

  filterInvoices() {
    let filtered = [...this.invoices];
    if (this.searchTerm) {
      filtered = filtered.filter(inv =>
        (inv.invoiceNumber || '').toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        (inv.customerName || '').toLowerCase().includes(this.searchTerm.toLowerCase())
      );
    }
    if (this.exportType === 'customer' && this.selectedCustomerId) {
      filtered = filtered.filter(inv => inv.customerId == this.selectedCustomerId);
    }
    this.filteredInvoices = filtered;
  }

  openExportModal() {
    this.exportType = 'all';
    this.selectedCustomerId = '';
    this.selectedInvoiceId = '';
    this.searchTerm = '';
    this.filteredInvoices = [...this.invoices];
    this.showExportModal = true;
  }

  closeExportModal() { this.showExportModal = false; }

  onExportTypeChange() {
    this.searchTerm = '';
    this.selectedCustomerId = '';
    this.selectedInvoiceId = '';
    this.filteredInvoices = [...this.invoices];
  }

  onCustomerChange() {
    this.filteredInvoices = this.invoices.filter(inv => inv.customerId == this.selectedCustomerId);
  }

  getTotalCN(details: any): number {
    if (!details?.creditNotes) return 0;
    return details.creditNotes
      .filter((cn: any) => !cn.createdAfterPayment)
      .reduce((sum: number, cn: any) => sum + (cn.amount || 0), 0);
  }

  getFilteredCNs(details: any): any[] {
    if (!details?.creditNotes) return [];
    return details.creditNotes.filter((cn: any) => !cn.createdAfterPayment);
  }

  exportPDF() {
    let invoicesToExport: any[] = [];
    if (this.exportType === 'all') {
      invoicesToExport = [...this.filteredInvoices];
    } else if (this.exportType === 'customer') {
      if (!this.selectedCustomerId) { this.showToastMsg('Please select a customer'); return; }
      invoicesToExport = this.invoices.filter(inv => inv.customerId == this.selectedCustomerId);
    } else if (this.exportType === 'single') {
      if (!this.selectedInvoiceId) { this.showToastMsg('Please select an invoice'); return; }
      invoicesToExport = this.invoices.filter(inv => inv.id == this.selectedInvoiceId);
    }
    if (invoicesToExport.length === 0) { this.showToastMsg('No invoices to export'); return; }
    this.isLoading = true;
    const detailRequests = invoicesToExport.map(inv =>
      this.api.getInvoiceDetails(inv.id).pipe(catchError(() => of(null)))
    );
    forkJoin(detailRequests).subscribe({
      next: (details: any[]) => {
        this.isLoading = false;
        const doc = new jsPDF();
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.text('Invoice Report', 14, 20);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text('Generated: ' + new Date().toLocaleDateString(), 14, 28);
        if (this.exportType === 'customer' && this.selectedCustomerId) {
          const customer = this.customers.find(c => c.id == this.selectedCustomerId);
          doc.text('Customer: ' + (customer?.name || ''), 14, 35);
        }
        const tableData = invoicesToExport.map((inv, i) => {
          const detail = details[i];
          const totalCN = this.getTotalCN(detail);
          const netTotal = (inv.totalAmount || 0) - totalCN;
          const balance = netTotal - (inv.paidAmount || 0);
          return [
            inv.invoiceNumber || 'INV-' + inv.id,
            inv.customerName || '',
            new Date(inv.invoiceDate).toLocaleDateString(),
            'RM ' + (inv.totalAmount || 0).toFixed(2),
            totalCN > 0 ? 'RM ' + totalCN.toFixed(2) : '-',
            'RM ' + netTotal.toFixed(2),
            'RM ' + (inv.paidAmount || 0).toFixed(2),
            'RM ' + balance.toFixed(2),
            inv.status || 'Unpaid'
          ];
        });
        autoTable(doc, {
          startY: this.exportType === 'customer' ? 40 : 35,
          head: [['Invoice No', 'Customer', 'Date', 'Total', 'CN', 'Net Total', 'Paid', 'Balance', 'Status']],
          body: tableData,
          styles: { fontSize: 7 },
          headStyles: { fillColor: [26, 26, 26] },
          alternateRowStyles: { fillColor: [240, 235, 227] }
        });
        const totalAmount = invoicesToExport.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);
        const totalCNAll = details.reduce((sum, d) => sum + this.getTotalCN(d), 0);
        const totalNetAll = totalAmount - totalCNAll;
        const totalPaid = invoicesToExport.reduce((sum, inv) => sum + (inv.paidAmount || 0), 0);
        const totalBalance = totalNetAll - totalPaid;
        const finalY = (doc as any).lastAutoTable.finalY + 10;
        doc.setFont('helvetica', 'bold');
        doc.text('Summary:', 14, finalY);
        doc.setFont('helvetica', 'normal');
        doc.text('Total Invoices: ' + invoicesToExport.length, 14, finalY + 6);
        doc.text('Total Amount: RM ' + totalAmount.toFixed(2), 14, finalY + 12);
        doc.text('Total CN: RM ' + totalCNAll.toFixed(2), 14, finalY + 18);
        doc.text('Net Total: RM ' + totalNetAll.toFixed(2), 14, finalY + 24);
        doc.text('Total Paid: RM ' + totalPaid.toFixed(2), 14, finalY + 30);
        doc.text('Total Balance: RM ' + totalBalance.toFixed(2), 14, finalY + 36);
        doc.save('invoice-report-' + new Date().toISOString().split('T')[0] + '.pdf');
        this.showToastMsg('PDF exported successfully!');
        this.closeExportModal();
      },
      error: () => { this.isLoading = false; this.showToastMsg('Failed to export'); }
    });
  }

  exportSingle(invoice: any) {
    this.api.getInvoiceDetails(invoice.id).subscribe({
      next: (detail: any) => {
        const filteredCNs = this.getFilteredCNs(detail);
        const totalCN = filteredCNs.reduce((sum: number, cn: any) => sum + (cn.amount || 0), 0);
        const netTotal = (invoice.totalAmount || 0) - totalCN;
        const balance = netTotal - (invoice.paidAmount || 0);

        const doc = new jsPDF();
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.text('Invoice', 14, 20);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text('Invoice No: ' + invoice.invoiceNumber, 14, 30);
        doc.text('Customer: ' + invoice.customerName, 14, 37);
        doc.text('Date: ' + new Date(invoice.invoiceDate).toLocaleDateString(), 14, 44);
        doc.text('Status: ' + invoice.status, 14, 51);

        const itemRows: any[] = [];
        if (detail?.items && detail.items.length > 0) {
          detail.items.forEach((item: any) => {
            itemRows.push([item.productName || '', item.quantity, 'RM ' + (item.unitPrice || 0).toFixed(2), 'RM ' + (item.total || 0).toFixed(2), '']);
          });
        }

        // ? Credit Used ??????
        if (detail?.creditUsed > 0) {
          itemRows.push(['', '', '', '', '']);
          itemRows.push([
            'Credit Balance Used' + (detail.creditCNNumber ? ' (' + detail.creditCNNumber + ')' : ''),
            '',
            '',
            '- RM ' + (detail.creditUsed || 0).toFixed(2),
            ''
          ]);
        }

        // ? CN ??????
        if (filteredCNs.length > 0) {
          itemRows.push(['', '', '', '', '']);
          filteredCNs.forEach((cn: any) => {
            itemRows.push([
              'Credit Note: ' + cn.cnNumber,
              '',
              'Reason: ' + (cn.reason || ''),
              '- RM ' + cn.amount.toFixed(2),
              cn.createdAt ? new Date(cn.createdAt).toLocaleDateString() : ''
            ]);
          });
        }

        autoTable(doc, {
          startY: 58,
          head: [['Product / CN', 'Qty', 'Unit Price / Reason', 'Amount', 'Date']],
          body: itemRows,
          styles: { fontSize: 8 },
          headStyles: { fillColor: [26, 26, 26] },
          alternateRowStyles: { fillColor: [240, 235, 227] },
          didParseCell: (data: any) => {
            if (data.row.raw && data.row.raw[0] && String(data.row.raw[0]).startsWith('Credit Note:')) {
              data.cell.styles.textColor = [230, 126, 34];
              data.cell.styles.fontStyle = 'bold';
            }
            if (data.row.raw && data.row.raw[0] && String(data.row.raw[0]).startsWith('Credit Balance Used')) {
              data.cell.styles.textColor = [39, 174, 96];
              data.cell.styles.fontStyle = 'bold';
            }
          }
        });

        const finalY = (doc as any).lastAutoTable?.finalY + 10 || 70;
        doc.setFont('helvetica', 'bold');
        doc.text('Total Amount:  RM ' + (invoice.totalAmount || 0).toFixed(2), 14, finalY);
        if (totalCN > 0) {
          doc.setTextColor(230, 126, 34);
          doc.text('Total CN:      - RM ' + totalCN.toFixed(2), 14, finalY + 7);
          doc.setTextColor(0, 0, 0);
          doc.text('Net Total:     RM ' + netTotal.toFixed(2), 14, finalY + 14);
          doc.setTextColor(39, 174, 96);
          doc.text('Paid:          RM ' + (invoice.paidAmount || 0).toFixed(2), 14, finalY + 21);
          doc.setTextColor(229, 115, 115);
          doc.text('Balance:       RM ' + balance.toFixed(2), 14, finalY + 28);
        } else {
          doc.setTextColor(39, 174, 96);
          doc.text('Paid:          RM ' + (invoice.paidAmount || 0).toFixed(2), 14, finalY + 7);
          doc.setTextColor(229, 115, 115);
          doc.text('Balance:       RM ' + balance.toFixed(2), 14, finalY + 14);
        }
        doc.setTextColor(0, 0, 0);
        doc.save(invoice.invoiceNumber + '.pdf');
        this.showToastMsg('PDF exported!');
      },
      error: () => { this.showToastMsg('Failed to export'); }
    });
  }

  backupFull() {
    this.api.getFullBackup().subscribe({
      next: () => { this.showToastMsg('Backup successful!'); },
      error: () => { this.showToastMsg('Backup failed!'); }
    });
  }

  showToastMsg(msg: string) { this.toastMessage = msg; this.showToast = true; }
  goTo(path: string) { this.navCtrl.navigateRoot(path); }

  goBack() { this.router.navigate(['pages/home']); }
}
