import { Injectable } from '@angular/core';
import { AlertService } from './alert.service';

@Injectable({
  providedIn: 'root'
})
export class BluetoothPrintService {
  constructor(private alertService: AlertService) {}

  /** Checks if bluetoothSerial plugin is available on the window */
  private get bluetoothSerial(): any {
    return (window as any).bluetoothSerial;
  }

  isAvailable(): boolean {
    return !!this.bluetoothSerial;
  }

  /** Formats columns to perfectly align left and right parts within the character width */
  private formatRow(left: string, right: string, width: number): string {
    const spaceNeeded = width - left.length - right.length;
    if (spaceNeeded > 0) {
      return left + ' '.repeat(spaceNeeded) + right;
    } else {
      // If it overflows, truncate the left column so the right column aligns perfectly
      const maxLeftLen = width - right.length - 1;
      return left.substring(0, maxLeftLen) + ' ' + right;
    }
  }

  /** Prints an invoice directly to the configured Bluetooth MAC address */
  printInvoice(inv: any, pd: any, settings: any, customers: any[], products: any[]): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.isAvailable()) {
        this.alertService.toast('Bluetooth printing is only available on native devices (APK)', 'error');
        return resolve(false);
      }

      const mac = settings.macAddress || '02:29:DE:43:D8:2C';

      const permissions = (window as any).plugins?.permissions;
      if (permissions && permissions.BLUETOOTH_CONNECT) {
        permissions.hasPermission(permissions.BLUETOOTH_CONNECT, (status: any) => {
          if (status.hasPermission) {
            this.connectAndPrint(mac, inv, pd, settings, customers, products, resolve);
          } else {
            permissions.requestPermission(permissions.BLUETOOTH_CONNECT, (s: any) => {
              if (s.hasPermission) {
                this.connectAndPrint(mac, inv, pd, settings, customers, products, resolve);
              } else {
                this.alertService.toast('Nearby Devices permission is required to print.', 'error');
                resolve(false);
              }
            }, () => {
              resolve(false);
            });
          }
        }, () => resolve(false));
      } else {
        this.connectAndPrint(mac, inv, pd, settings, customers, products, resolve);
      }
    });
  }

  private connectAndPrint(mac: string, inv: any, pd: any, settings: any, customers: any[], products: any[], resolve: any) {
    this.alertService.toast(`Connecting to printer...`, 'success');
    this.bluetoothSerial.isEnabled(
      () => {
        this.bluetoothSerial.connect(
          mac,
          () => {
            try {
              this.sendPrintData(inv, pd, settings, customers, products)
                .then(() => {
                  this.bluetoothSerial.disconnect();
                  resolve(true);
                })
                .catch((err) => {
                  this.bluetoothSerial.disconnect();
                  this.alertService.toast(`Printing failed: ${err.message || err}`, 'error');
                  resolve(false);
                });
            } catch (e: any) {
              this.bluetoothSerial.disconnect();
              this.alertService.toast(`Format error: ${e.message}`, 'error');
              resolve(false);
            }
          },
          (err: any) => {
            this.alertService.toast(`Failed to connect to printer: ${err}`, 'error');
            resolve(false);
          }
        );
      },
      () => {
        this.alertService.toast('Please turn on Bluetooth first', 'warning');
        resolve(false);
      }
    );
  }

  private sendPrintData(inv: any, pd: any, settings: any, customers: any[], products: any[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const width = settings.paperWidth === 58 ? 32 : 48;
      const builder = new BufferBuilder();

      // --- ESC/POS commands ---
      const ESC = 0x1B;
      const GS = 0x1D;

      const CMD_INIT = [ESC, 0x40];
      const CMD_ALIGN_LEFT = [ESC, 0x61, 0x00];
      const CMD_ALIGN_CENTER = [ESC, 0x61, 0x01];
      const CMD_ALIGN_RIGHT = [ESC, 0x61, 0x02];
      const CMD_BOLD_ON = [ESC, 0x45, 0x01];
      const CMD_BOLD_OFF = [ESC, 0x45, 0x00];
      const CMD_DOUBLE_SIZE = [GS, 0x21, 0x11];
      const CMD_NORMAL_SIZE = [GS, 0x21, 0x00];

      // Helper helper to get customer details
      const getCustomer = (id: any) => customers.find((c: any) => c.id == id);
      const getProductName = (id: any) => {
        const p = products.find((x: any) => x.id == id);
        return p ? p.name : 'Product #' + id;
      };
      const getCustomerFullAddress = (id: any): string => {
        const c = getCustomer(id);
        if (!c) return '';
        const branch = (c.branches && c.branches.length > 0)
          ? (c.branches.find((b: any) => b.isDefaultBranch) || c.branches[0])
          : null;
        if (branch) {
          return [branch.address1, branch.city, branch.postcode, branch.state].filter(p => !!p).join(', ');
        }
        return c.address || '';
      };

      const isOptionEnabled = (name: string): boolean => {
        if (!settings.contentOptions) return true;
        const opt = settings.contentOptions.find((o: any) => o.name === name);
        return opt ? opt.enabled : true;
      };

      // 1. Initialize printer
      builder.append(CMD_INIT);

      // 2. Header
      builder.append(CMD_ALIGN_CENTER);
      builder.append(CMD_BOLD_ON);
      builder.append(CMD_DOUBLE_SIZE);
      builder.appendText("TAX INVOICE\n");
      builder.append(CMD_NORMAL_SIZE);
      builder.append(CMD_BOLD_OFF);
      builder.append(CMD_ALIGN_LEFT);
      builder.appendText("-".repeat(width) + "\n");

      // 3. Company Info
      if (isOptionEnabled('Print Company Logo')) {
        builder.append(CMD_ALIGN_CENTER);
        builder.append(CMD_BOLD_ON);
        builder.appendText((pd?.companyName || 'B JAYA TRADING') + "\n");
        builder.append(CMD_BOLD_OFF);
        builder.appendText(`(${pd?.companyReg || '001188861-T'})\n`);
        builder.appendText((pd?.companyAddress || 'NO. 467, JALAN PALAS 13, TAMAN PELANGI,') + "\n");
        builder.appendText((pd?.companyCity || '70400 SEREMBAN N.S, MALAYSIA') + "\n");
        builder.appendText(`TEL: ${pd?.companyTel || '012-6988080'} GST: ${pd?.companyGst || '000134806856'}\n`);
        builder.append(CMD_ALIGN_LEFT);
        builder.appendText("-".repeat(width) + "\n");
      }

      // 4. Document Meta
      const docNo = inv?.invoiceNumber || 'S001-' + inv?.id;
      builder.appendText(`DOC NO: ${docNo}\n`);
      if (isOptionEnabled('Print Issue Time')) {
        const invoiceDate = inv?.invoiceDate ? new Date(inv.invoiceDate) : new Date();
        const dateStr = invoiceDate.toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
        builder.appendText(`DATE  : ${dateStr}\n`);
      }

      // 5. Customer Info
      if (isOptionEnabled('Print Customer Tel') || isOptionEnabled('Print Customer Add')) {
        const c = getCustomer(inv?.customerId);
        builder.appendText("\nTO:\n");
        builder.appendText(`${inv?.customerName || (c ? c.name : 'Customer #' + inv?.customerId)}\n`);
        if (isOptionEnabled('Print Customer Tel') && c?.phone) {
          builder.appendText(`TEL: ${c.phone}\n`);
        }
        if (isOptionEnabled('Print Customer Add')) {
          const addr = getCustomerFullAddress(inv?.customerId);
          if (addr) {
            builder.appendText(`ADD: ${addr}\n`);
          }
        }
      }

      builder.appendText("-".repeat(width) + "\n");

      // 6. Items Table Header
      builder.appendText(this.formatRow("DESCRIPTION", "GST SUBTOTAL", width) + "\n");
      builder.appendText("-".repeat(width) + "\n");

      // 7. Items List
      const items = pd?.items || inv?.items || [];
      items.forEach((item: any, i: number) => {
        let prodName = item.productName || getProductName(item.productId);
        if (isOptionEnabled('Print Item Code')) {
          const product = products.find(p => p.id == item.productId);
          const code = product?.productCode || product?.code || '';
          if (code) {
            prodName = `[${code}] ${prodName}`;
          }
        }
        const uom = isOptionEnabled('Print Item U.O.M.') ? ` (${item.uom || 'UNIT'})` : '';
        const descRow = `${i + 1}. ${prodName}${uom}`;
        builder.appendText(this.formatRow(descRow, `[${item.taxType || 'SR'}]`, width) + "\n");

        const qtyStr = `${item.quantity} x ${(item.unitPrice || 0).toFixed(2)}`;
        const subtotal = ((item.quantity || 0) * (item.unitPrice || 0)).toFixed(2);
        builder.appendText(this.formatRow(`   ${qtyStr}`, `RM ${subtotal}`, width) + "\n");

        if (item.remark) {
          builder.appendText(`   * ${item.remark}\n`);
        }
      });

      builder.appendText("-".repeat(width) + "\n");

      // 8. Financial Summary
      builder.appendText(this.formatRow("GROSS TOTAL", `RM ${(inv?.totalAmount || 0).toFixed(2)}`, width) + "\n");

      // Credit Notes (CN) returns
      const getReceiptCreditNotes = (): any[] => {
        if (!inv?.creditNotes) return [];
        return inv.creditNotes.filter((cn: any) => !(cn.cnNumber || '').startsWith('CN-CHG'));
      };
      const getReceiptNetAmount = (): number => {
        const gross = inv?.totalAmount || 0;
        const totalReturns = getReceiptCreditNotes().reduce((sum: number, cn: any) => sum + (cn.amount || 0), 0);
        const creditUsed = inv?.creditUsed || 0;
        const net = gross - totalReturns - creditUsed;
        return net > 0 ? net : 0;
      };
      const getReceiptBalance = (): number => {
        const net = getReceiptNetAmount();
        const paid = inv?.paidAmount || 0;
        const bal = net - paid;
        return bal > 0 ? bal : 0;
      };

      const cns = getReceiptCreditNotes();
      const totalReturns = cns.reduce((sum: number, cn: any) => sum + (cn.amount || 0), 0);
      if (totalReturns > 0) {
        builder.appendText(this.formatRow("RETURNS (CN)", `- RM ${totalReturns.toFixed(2)}`, width) + "\n");
      }

      const creditUsed = inv?.creditUsed || inv?.CreditUsed || 0;
      if (creditUsed > 0) {
        builder.appendText(this.formatRow("CREDIT USED", `- RM ${creditUsed.toFixed(2)}`, width) + "\n");
      }

      const changeCNs = (inv?.creditNotes || []).filter((cn: any) => (cn.cnNumber || '').startsWith('CN-CHG'));
      const totalChange = changeCNs.reduce((sum: number, cn: any) => sum + (cn.amount || 0), 0);
      if (totalChange > 0) {
        builder.appendText(this.formatRow("CHANGE AS CREDIT", `+ RM ${totalChange.toFixed(2)}`, width) + "\n");
      }

      // Net Amount (BOLD)
      const netAmount = getReceiptNetAmount();
      builder.append(CMD_BOLD_ON);
      builder.appendText(this.formatRow("NET AMOUNT", `RM ${netAmount.toFixed(2)}`, width) + "\n");
      builder.append(CMD_BOLD_OFF);

      // Payment Details
      const paymentStatus = inv?.status === 'Paid' ? 'PAID' : inv?.status === 'Partial' ? 'PARTIALLY PAID' : 'UNPAID';
      builder.appendText(this.formatRow("PAYMENT STATUS", paymentStatus, width) + "\n");

      const displayedPaid = (inv?.paidAmount || 0) + totalChange;
      builder.appendText(this.formatRow("PAID AMOUNT", `RM ${displayedPaid.toFixed(2)}`, width) + "\n");

      const balance = getReceiptBalance();
      builder.append(CMD_BOLD_ON);
      builder.appendText(this.formatRow("BALANCE DUE", `RM ${balance.toFixed(2)}`, width) + "\n");
      builder.append(CMD_BOLD_OFF);

      // Transaction CN breakdown details
      if (cns.length > 0) {
        builder.appendText("-".repeat(width) + "\n");
        builder.appendText("TRANSACTION DETAILS:\n");
        cns.forEach((cn: any) => {
          builder.appendText(` * ${cn.cnNumber || 'CN-' + cn.id}\n`);
          builder.appendText(this.formatRow("   Refund Amount", `- RM ${(cn.amount || 0).toFixed(2)}`, width) + "\n");
          if (cn.items && cn.items.length > 0) {
            cn.items.forEach((item: any) => {
              builder.appendText(`     • ${item.productName} (${item.quantity}x${item.unitPrice.toFixed(2)})\n`);
            });
          }
        });
      }

      // 9. Due Date
      if (isOptionEnabled('Print Term Date')) {
        const dueStr = pd?.paymentDue || (inv?.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString('en-GB') : '');
        builder.appendText("\n");
        builder.append(CMD_ALIGN_CENTER);
        builder.appendText(`PAYMENT DUE: ${dueStr}\n`);
        builder.append(CMD_ALIGN_LEFT);
      }

      // 10. Signature Boxes
      const showCashSig = inv?.termType === 'CASH SALE' && isOptionEnabled('Sign on Cash Invoice');
      const showCreditSig = inv?.termType === 'On Credit' && isOptionEnabled('Sign on Credit Invoice');
      const showCNSig = (totalReturns > 0) && isOptionEnabled('Sign on Credit Note');
      const showPaymentSig = (inv?.paidAmount > 0) && isOptionEnabled('Sign on Payment');

      if (showCashSig || showCreditSig || showCNSig || showPaymentSig) {
        const sigLabelText = 'SIGNATURE';

        builder.appendText("\n\n\n\n\n");
        builder.append(CMD_ALIGN_CENTER);
        builder.appendText("...........................\n");
        builder.appendText(`${sigLabelText}\n`);
        builder.append(CMD_ALIGN_LEFT);
      }

      // 11. Footer
      if (isOptionEnabled('Footer')) {
        builder.appendText("\n");
        builder.append(CMD_ALIGN_CENTER);
        builder.appendText("THANK YOU\n");
        builder.append(CMD_ALIGN_LEFT);
      }

      // 12. Spacing lines
      const emptyLines = settings.bottomEmptyLine ?? 5;
      builder.appendText("\n".repeat(emptyLines));

      // Write data to bluetooth
      const buffer = builder.getBuffer();
      this.bluetoothSerial.write(
        buffer,
        () => resolve(),
        (err: any) => reject(err)
      );
    });
  }

  printPayment(pd: any, settings: any, customers: any[], products: any[]): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.isAvailable()) {
        this.alertService.toast('Bluetooth printing is only available on native devices (APK)', 'error');
        return resolve(false);
      }

      const mac = settings.macAddress || '02:29:DE:43:D8:2C';

      const permissions = (window as any).plugins?.permissions;
      if (permissions && permissions.BLUETOOTH_CONNECT) {
        permissions.hasPermission(permissions.BLUETOOTH_CONNECT, (status: any) => {
          if (status.hasPermission) {
            this.connectAndPrintPayment(mac, pd, settings, customers, products, resolve);
          } else {
            permissions.requestPermission(permissions.BLUETOOTH_CONNECT, (s: any) => {
              if (s.hasPermission) {
                this.connectAndPrintPayment(mac, pd, settings, customers, products, resolve);
              } else {
                this.alertService.toast('Nearby Devices permission is required to print.', 'error');
                resolve(false);
              }
            }, () => {
              resolve(false);
            });
          }
        }, () => resolve(false));
      } else {
        this.connectAndPrintPayment(mac, pd, settings, customers, products, resolve);
      }
    });
  }

  private connectAndPrintPayment(mac: string, pd: any, settings: any, customers: any[], products: any[], resolve: any) {
    this.alertService.toast(`Connecting to printer...`, 'success');
    this.bluetoothSerial.isEnabled(
      () => {
        this.bluetoothSerial.connect(
          mac,
          () => {
            try {
              this.sendPrintPaymentData(pd, settings, customers, products)
                .then(() => {
                  this.bluetoothSerial.disconnect();
                  resolve(true);
                })
                .catch((err) => {
                  this.bluetoothSerial.disconnect();
                  this.alertService.toast(`Printing failed: ${err.message || err}`, 'error');
                  resolve(false);
                });
            } catch (e: any) {
              this.bluetoothSerial.disconnect();
              this.alertService.toast(`Format error: ${e.message}`, 'error');
              resolve(false);
            }
          },
          (err: any) => {
            this.alertService.toast(`Failed to connect to printer: ${err}`, 'error');
            resolve(false);
          }
        );
      },
      () => {
        this.alertService.toast('Please turn on Bluetooth first', 'warning');
        resolve(false);
      }
    );
  }

  private sendPrintPaymentData(pd: any, settings: any, customers: any[], products: any[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const width = settings.paperWidth === 58 ? 32 : 48;
      const builder = new BufferBuilder();

      const ESC = 0x1B;
      const GS = 0x1D;

      const CMD_INIT = [ESC, 0x40];
      const CMD_ALIGN_LEFT = [ESC, 0x61, 0x00];
      const CMD_ALIGN_CENTER = [ESC, 0x61, 0x01];
      const CMD_BOLD_ON = [ESC, 0x45, 0x01];
      const CMD_BOLD_OFF = [ESC, 0x45, 0x00];
      const CMD_DOUBLE_SIZE = [GS, 0x21, 0x11];
      const CMD_NORMAL_SIZE = [GS, 0x21, 0x00];

      const getCustomer = (id: any) => customers.find((c: any) => c.id == id);
      const isOptionEnabled = (name: string): boolean => {
        if (!settings.contentOptions) return true;
        const opt = settings.contentOptions.find((o: any) => o.name === name);
        return opt ? opt.enabled : true;
      };

      builder.append(CMD_INIT);

      // Title
      builder.append(CMD_ALIGN_CENTER);
      builder.append(CMD_BOLD_ON);
      builder.append(CMD_DOUBLE_SIZE);
      builder.appendText("OFFICIAL RECEIPT\n");
      builder.append(CMD_NORMAL_SIZE);
      builder.append(CMD_BOLD_OFF);
      builder.append(CMD_ALIGN_LEFT);
      builder.appendText("-".repeat(width) + "\n");

      // Company Info
      if (isOptionEnabled('Print Company Logo')) {
        builder.append(CMD_ALIGN_CENTER);
        builder.append(CMD_BOLD_ON);
        builder.appendText("B JAYA TRADING\n");
        builder.append(CMD_BOLD_OFF);
        builder.appendText("(001188861-T)\n");
        builder.appendText("NO. 467, JALAN PALAS 13, TAMAN PELANGI,\n");
        builder.appendText("70400 SEREMBAN N.S, MALAYSIA\n");
        builder.appendText("TEL: 012-6988080\n");
        builder.append(CMD_ALIGN_LEFT);
        builder.appendText("-".repeat(width) + "\n");
      }

      // Receipt Meta
      builder.appendText(`RECEIPT NO: ${pd.receiptNumber || 'RCPT-' + pd.id}\n`);
      builder.appendText(`INVOICE NO: ${pd.invoice?.invoiceNumber || ''}\n`);
      if (isOptionEnabled('Print Issue Time')) {
        const payDate = pd.paymentDate ? new Date(pd.paymentDate) : new Date();
        const dateStr = payDate.toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
        builder.appendText(`DATE      : ${dateStr}\n`);
      }

      // Customer Info
      if (isOptionEnabled('Print Customer Tel') || isOptionEnabled('Print Customer Add')) {
        const c = getCustomer(pd.customer?.id);
        builder.appendText("\nTO:\n");
        builder.appendText(`${pd.customer?.name || ''}\n`);
        if (isOptionEnabled('Print Customer Tel') && pd.customer?.phone) {
          builder.appendText(`TEL: ${pd.customer?.phone}\n`);
        }
      }

      builder.appendText("-".repeat(width) + "\n");

      // Items Table Header
      builder.appendText(this.formatRow("DESCRIPTION", "SUBTOTAL", width) + "\n");
      builder.appendText("-".repeat(width) + "\n");

      // Items List
      const items = pd.invoice?.items || [];
      items.forEach((item: any, i: number) => {
        const descRow = `${i + 1}. ${item.productName}`;
        builder.appendText(descRow + "\n");
        const qtyStr = `${item.quantity} x ${(item.unitPrice || 0).toFixed(2)}`;
        const subtotal = (item.total || 0).toFixed(2);
        builder.appendText(this.formatRow(`   ${qtyStr}`, `RM ${subtotal}`, width) + "\n");
      });

      builder.appendText("-".repeat(width) + "\n");

      // Payment Method
      builder.appendText(this.formatRow("PAYMENT METHOD", pd.paymentMethod || '', width) + "\n");
      if (pd.referenceNo) {
        builder.appendText(this.formatRow("REFERENCE NO", pd.referenceNo, width) + "\n");
      }
      builder.appendText(this.formatRow("INVOICE TOTAL", `RM ${(pd.invoice?.totalAmount || 0).toFixed(2)}`, width) + "\n");
      builder.appendText(this.formatRow("INVOICE BALANCE", `RM ${(pd.invoice?.balance || 0).toFixed(2)}`, width) + "\n");
      builder.appendText("-".repeat(width) + "\n");

      // Net Amount (BOLD)
      builder.append(CMD_BOLD_ON);
      builder.appendText(this.formatRow("PAYMENT RECEIVED", `RM ${(pd.paymentAmount || 0).toFixed(2)}`, width) + "\n");
      builder.append(CMD_BOLD_OFF);

      // Signature Box
      if (isOptionEnabled('Sign on Payment')) {
        builder.appendText("\n\n\n\n\n");
        builder.append(CMD_ALIGN_CENTER);
        builder.appendText("...........................\n");
        builder.appendText("PAYMENT RECEIVED SIGNATURE\n");
        builder.append(CMD_ALIGN_LEFT);
      }

      // Footer
      if (isOptionEnabled('Footer')) {
        builder.appendText("\n");
        builder.append(CMD_ALIGN_CENTER);
        builder.appendText("THANK YOU\n");
        builder.append(CMD_ALIGN_LEFT);
      }

      // Spacing lines
      const emptyLines = settings.bottomEmptyLine ?? 5;
      builder.appendText("\n".repeat(emptyLines));

      const buffer = builder.getBuffer();
      this.bluetoothSerial.write(
        buffer,
        () => resolve(),
        (err: any) => reject(err)
      );
    });
  }
}

/** Helper class to build ESC/POS payload */
class BufferBuilder {
  private chunks: Uint8Array[] = [];

  append(bytes: number[] | Uint8Array) {
    if (bytes instanceof Uint8Array) {
      this.chunks.push(bytes);
    } else {
      this.chunks.push(new Uint8Array(bytes));
    }
  }

  appendText(text: string) {
    const encoder = new TextEncoder();
    this.chunks.push(encoder.encode(text));
  }

  getBuffer(): ArrayBuffer {
    let totalLen = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    let result = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result.buffer as ArrayBuffer;
  }
}
