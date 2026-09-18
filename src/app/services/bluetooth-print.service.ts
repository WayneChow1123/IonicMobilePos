import { Injectable } from '@angular/core';
import { AlertService } from './alert.service';
import { formatDocNo } from '../utils/invoice-helper';

/** Sanitizes text to pure single-byte ASCII to prevent thermal printer character set corruptions (e.g. garbled Chinese) */
export function sanitizePrintText(str: string): string {
  if (!str) return '';
  return str
    // Convert fullwidth parentheses with space separation if touching letters
    .replace(/\s*[\uFF08\u3014]\s*/g, ' (')
    .replace(/\s*[\uFF09\u3015]\s*/g, ') ')
    // Convert fullwidth commas and colons with proper spacing
    .replace(/\s*[\uFF0C\u3001]\s*/g, ', ')
    .replace(/\s*[\uFF1A]\s*/g, ': ')
    .replace(/\s*[\uFF1B]\s*/g, '; ')
    // Convert fullwidth ASCII range (0xFF01 - 0xFF5E) to standard ASCII (0x21 - 0x7E)
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    // Fullwidth space
    .replace(/\u3000/g, ' ')
    // Quotes and brackets
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u3010]/g, '[')
    .replace(/[\u3011]/g, ']')
    .replace(/[\u300A]/g, '<')
    .replace(/[\u300B]/g, '>')
    .replace(/[\u2014\u2013]/g, '-')
    // Common fractions
    .replace(/\u00BD/g, '1/2')
    .replace(/\u00BC/g, '1/4')
    .replace(/\u00BE/g, '3/4')
    // Non-breaking space
    .replace(/\u00A0/g, ' ');
}

@Injectable({
  providedIn: 'root'
})
export class BluetoothPrintService {
  private isPrinting = false;
  private disconnectTimer: any = null;
  private currentConnectedMac: string | null = null;

  constructor(private alertService: AlertService) {}

  /** Checks if bluetoothSerial plugin is available on the window */
  private get bluetoothSerial(): any {
    return (window as any).bluetoothSerial;
  }

  isAvailable(): boolean {
    return !!this.bluetoothSerial;
  }

  /** Formats columns to perfectly align left and right parts within the character width without overflowing */
  private formatRow(left: string, right: string, width: number): string {
    const l = sanitizePrintText(left);
    const r = sanitizePrintText(right);
    const spaceNeeded = width - l.length - r.length;
    if (spaceNeeded >= 0) {
      return l + ' '.repeat(spaceNeeded) + r;
    } else {
      // If it overflows, truncate the left column so the right column aligns perfectly
      const maxLeftLen = Math.max(0, width - r.length - 1);
      return l.substring(0, maxLeftLen) + ' ' + r;
    }
  }

  /** Centers text within the specified character width */
  private centerText(text: string, width: number): string {
    const t = sanitizePrintText(text);
    if (t.length >= width) return t.substring(0, width);
    const leftPad = Math.floor((width - t.length) / 2);
    return ' '.repeat(leftPad) + t;
  }

  /** Wraps text into an array of lines without exceeding maxLen */
  private wrapText(text: string, maxLen: number): string[] {
    const t = sanitizePrintText(text).trim();
    if (!t) return [];
    if (t.length <= maxLen) return [t];

    const words = t.split(' ');
    const lines: string[] = [];
    let current = '';

    for (const w of words) {
      if (!w) continue;
      if (!current) {
        if (w.length <= maxLen) {
          current = w;
        } else {
          for (let i = 0; i < w.length; i += maxLen) {
            lines.push(w.substring(i, i + maxLen));
          }
        }
      } else if ((current + ' ' + w).length <= maxLen) {
        current += ' ' + w;
      } else {
        lines.push(current);
        if (w.length <= maxLen) {
          current = w;
        } else {
          for (let i = 0; i < w.length; i += maxLen) {
            const chunk = w.substring(i, i + maxLen);
            if (i + maxLen < w.length) {
              lines.push(chunk);
            } else {
              current = chunk;
            }
          }
        }
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  /** Formats a boxed line with vertical borders: "| text                       |" */
  private boxLine(text: string, width: number): string {
    const innerWidth = width - 4;
    const t = sanitizePrintText(text);
    const safeText = t.length > innerWidth ? t.substring(0, innerWidth) : t;
    return '| ' + safeText.padEnd(innerWidth, ' ') + ' |';
  }

  /** Formats a centered boxed line: "|         PAYMENT DUE        |" */
  private boxCenterLine(text: string, width: number): string {
    const innerWidth = width - 4;
    const t = sanitizePrintText(text);
    const safeText = t.length > innerWidth ? t.substring(0, innerWidth) : t;
    const leftPad = Math.floor((innerWidth - safeText.length) / 2);
    const rightPad = innerWidth - safeText.length - leftPad;
    return '| ' + ' '.repeat(Math.max(0, leftPad)) + safeText + ' '.repeat(Math.max(0, rightPad)) + ' |';
  }

  /** Checks and requests BLUETOOTH_CONNECT permission if applicable on Android 12+ */
  private checkPermission(onGranted: () => void, onDenied: () => void) {
    const permissions = (window as any).plugins?.permissions;
    if (permissions && permissions.BLUETOOTH_CONNECT) {
      permissions.hasPermission(permissions.BLUETOOTH_CONNECT, (status: any) => {
        if (status && status.hasPermission) {
          onGranted();
        } else {
          permissions.requestPermission(permissions.BLUETOOTH_CONNECT, (s: any) => {
            if (s && s.hasPermission) {
              onGranted();
            } else {
              this.alertService.toast('Nearby Devices permission is required to print.', 'error');
              onDenied();
            }
          }, () => onDenied());
        }
      }, () => onDenied());
    } else {
      onGranted();
    }
  }

  /** Ensures Bluetooth RFCOMM connection is active, reusing existing connection if already connected to target MAC */
  private async ensureConnected(mac: string): Promise<void> {
    // 1. Cancel any pending disconnect timer immediately
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }

    // 2. Check if Bluetooth is currently enabled on phone
    await new Promise<void>((resolve, reject) => {
      this.bluetoothSerial.isEnabled(
        () => resolve(),
        () => reject(new Error('Please turn on Bluetooth first'))
      );
    });

    // 3. Check if currently connected
    const isAlreadyConnected = await new Promise<boolean>((resolve) => {
      this.bluetoothSerial.isConnected(
        () => resolve(true),
        () => resolve(false)
      );
    });

    if (isAlreadyConnected && this.currentConnectedMac === mac) {
      return; // Already connected to this printer!
    }

    // If connected to different device or stale link, disconnect cleanly first
    if (isAlreadyConnected) {
      await new Promise<void>((resolve) => {
        this.bluetoothSerial.disconnect(
          () => { this.currentConnectedMac = null; resolve(); },
          () => { this.currentConnectedMac = null; resolve(); }
        );
      });
    }

    // Connect to printer
    await new Promise<void>((resolve, reject) => {
      this.bluetoothSerial.connect(
        mac,
        () => {
          this.currentConnectedMac = mac;
          resolve();
        },
        (err: any) => {
          this.currentConnectedMac = null;
          reject(err);
        }
      );
    });
  }

  /**
   * Sends data in small chunks (256 bytes) with delay between chunks (35ms).
   * Prevents printer internal UART / RAM buffer overflow on thermal printers.
   */
  private async writeInChunks(buffer: ArrayBuffer, chunkSize = 256, delayMs = 35): Promise<void> {
    const bytes = new Uint8Array(buffer);
    const total = bytes.length;
    let offset = 0;

    while (offset < total) {
      const end = Math.min(offset + chunkSize, total);
      const chunk = bytes.slice(offset, end).buffer;

      await new Promise<void>((resolve, reject) => {
        this.bluetoothSerial.write(
          chunk,
          () => resolve(),
          (err: any) => reject(err)
        );
      });

      offset = end;
      if (offset < total) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  /** Safely closes the Bluetooth connection after physical printing completes */
  private safeDisconnect(immediate = false) {
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
    if (!immediate) return;

    if (this.isAvailable()) {
      this.bluetoothSerial.isConnected(
        () => {
          this.bluetoothSerial.disconnect(
            () => { this.currentConnectedMac = null; },
            () => { this.currentConnectedMac = null; }
          );
        },
        () => { this.currentConnectedMac = null; }
      );
    }
  }

  /**
   * Executes a complete print job:
   * 1. Connects to printer (or reuses open connection)
   * 2. Writes data in paced chunks (prevents buffer overflow)
   * 3. Calculates physical print time and keeps connection alive until printer finishes printing
   * 4. Schedules graceful background disconnect
   */
  private async executePrintJob(mac: string, buffer: ArrayBuffer, jobName: string, settings: any, resolve: (val: boolean) => void) {
    const { isAdapted } = this.resolvePrintWidth(settings);
    if (isAdapted) {
      this.alertService.toast('80mm selected: Auto-adapting to 48mm format for your printer', 'info');
    } else {
      this.alertService.toast(`Connecting to printer...`, 'info');
    }

    this.isPrinting = true;

    try {
      await this.ensureConnected(mac);

      this.alertService.toast(`Sending ${jobName} data...`, 'info');
      await this.writeInChunks(buffer, 256, 35);

      // Estimate printing duration: thermal printers print ~15-20 lines/s
      const lineEstimate = Math.max(20, Math.round(buffer.byteLength / 35));
      const printTimeMs = Math.round((lineEstimate / 15) * 1000) + 1500;
      const safeDelay = Math.min(6000, Math.max(3500, printTimeMs));

      // Keep Bluetooth connection open during physical printing, then gracefully disconnect in background
      this.disconnectTimer = setTimeout(() => {
        this.safeDisconnect(true);
      }, safeDelay);

      this.alertService.toast(`${jobName} printed successfully!`, 'success');
      this.isPrinting = false;
      resolve(true);
    } catch (err: any) {
      this.isPrinting = false;
      this.safeDisconnect(true);
      const msg = err?.message || err || 'Unknown error';
      this.alertService.toast(`Printing failed: ${msg}`, 'error');
      resolve(false);
    }
  }

  /** Prints an invoice directly to the configured Bluetooth MAC address */
  printInvoice(inv: any, pd: any, settings: any, customers: any[], products: any[]): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.isAvailable()) {
        this.alertService.toast('Bluetooth printing is only available on native devices (APK)', 'error');
        return resolve(false);
      }
      if (this.isPrinting) {
        this.alertService.toast('Printing in progress, please wait...', 'warning');
        return resolve(false);
      }

      const mac = settings.macAddress || '02:29:DE:43:D8:2C';
      this.checkPermission(
        () => {
          try {
            const buffer = this.buildInvoiceBuffer(inv, pd, settings, customers, products);
            this.executePrintJob(mac, buffer, 'Invoice', settings, resolve);
          } catch (e: any) {
            this.isPrinting = false;
            this.alertService.toast(`Format error: ${e.message}`, 'error');
            resolve(false);
          }
        },
        () => resolve(false)
      );
    });
  }

  /**
   * Resolves effective printing column width based on selected format and hardware capability.
   * - 48mm / 58mm format -> 40 columns
   * - 80mm format:
   *   - If machine is 48mm/58mm -> Auto-adapts to 48mm format (40 cols)
   *   - If machine is 80mm -> Normal 80mm format (48 cols)
   */
  resolvePrintWidth(settings: any): { width: number; isAdapted: boolean } {
    const selected = settings?.paperWidth ? Number(settings.paperWidth) : 48;
    const isAutoAdapt = settings?.autoAdapt !== false;

    if (selected >= 70) {
      const hardware = this.detectHardwareWidth(settings);
      if (isAutoAdapt && hardware <= 58) {
        return { width: 40, isAdapted: true };
      } else {
        return { width: 48, isAdapted: false };
      }
    } else {
      return { width: 40, isAdapted: false };
    }
  }

  private detectHardwareWidth(settings: any): number {
    const name = (settings?.deviceName || settings?.macAddress || '').toUpperCase();
    if (name.includes('80') || name.includes('300') || name.includes('800') || name.includes('83')) {
      return 80;
    }
    return 48; // Standard portable Bluetooth printer is 48mm
  }

  private buildInvoiceBuffer(inv: any, pd: any, settings: any, customers: any[], products: any[]): ArrayBuffer {
    const { width } = this.resolvePrintWidth(settings);
    const builder = new BufferBuilder();

      // --- ESC/POS commands ---
      const ESC = 0x1B;
      const GS = 0x1D;
      const FS = 0x1C;

      const CMD_INIT = [ESC, 0x40];
      const CMD_CANCEL_CHINESE = [FS, 0x2E]; // Turn off double-byte Chinese character mode to prevent garbled chars
      const CMD_ALIGN_LEFT = [ESC, 0x61, 0x00];
      const CMD_ALIGN_CENTER = [ESC, 0x61, 0x01];
      const CMD_ALIGN_RIGHT = [ESC, 0x61, 0x02];
      const CMD_BOLD_ON = [ESC, 0x45, 0x01];
      const CMD_BOLD_OFF = [ESC, 0x45, 0x00];
      const CMD_DOUBLE_HEIGHT = [GS, 0x21, 0x01];
      const CMD_NORMAL_SIZE = [GS, 0x21, 0x00];

      // Helpers
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

      // 1. Initialize printer & cancel double-byte Chinese mode
      builder.append(CMD_INIT);
      builder.append(CMD_CANCEL_CHINESE);

      // 2. Header (Matching Live Preview)
      builder.appendText("\n");
      builder.append(CMD_ALIGN_CENTER);
      builder.appendText("TAX INVOICE\n");
      builder.append(CMD_ALIGN_LEFT);
      builder.appendText("-".repeat(width) + "\n");

      // 3. Company Info
      if (isOptionEnabled('Print Company Logo')) {
        builder.append(CMD_ALIGN_CENTER);
        builder.append(CMD_BOLD_ON);
        builder.append(CMD_DOUBLE_HEIGHT);
        builder.appendText((pd?.companyName || 'B JAYA TRADING') + "\n");
        builder.append(CMD_NORMAL_SIZE);
        builder.append(CMD_BOLD_OFF);

        builder.appendText(`(${pd?.companyReg || '001188861-T'})\n`);

        const headerWrapWidth = width <= 40 ? 30 : 44;

        const addr1 = pd?.companyAddress || 'NO. 467, JALAN PALAS 13, TAMAN PELANGI,';
        this.wrapText(addr1, headerWrapWidth).forEach(line => {
          builder.appendText(line.trim() + "\n");
        });

        const city = pd?.companyCity || '70400 SEREMBAN N.S, SEREMBAN, N.S, MALAYSIA';
        this.wrapText(city, headerWrapWidth).forEach(line => {
          builder.appendText(line.trim() + "\n");
        });

        const tel = `TEL: ${pd?.companyTel || '012-6988080'}`;
        const gst = `GST: ${pd?.companyGst || '000134806856'}`;
        if ((tel + '   ' + gst).length <= headerWrapWidth) {
          builder.appendText(`${tel}   ${gst}\n`);
        } else {
          builder.appendText(tel + "\n");
          builder.appendText(gst + "\n");
        }

        builder.append(CMD_ALIGN_LEFT);
        builder.appendText("-".repeat(width) + "\n");
      }

      // 4. Document Meta
      const docNo = inv?.docNo || formatDocNo(inv);
      builder.appendText(`DOC NO : ${docNo}\n`);
      if (isOptionEnabled('Print Issue Time')) {
        const invoiceDate = inv?.invoiceDate ? new Date(inv.invoiceDate) : new Date();
        const dateStr = invoiceDate.toLocaleDateString('en-GB', {
          day: '2-digit',
          month: width <= 40 ? 'short' : 'long',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
        builder.appendText(`DATE   : ${dateStr}\n`);
      }

      // 5. Customer Info (Framed box matching Live Preview)
      if (isOptionEnabled('Print Customer Tel') || isOptionEnabled('Print Customer Add')) {
        const c = getCustomer(inv?.customerId);
        builder.appendText("\nTO:\n");
        builder.appendText("+" + "-".repeat(width - 2) + "+\n");

        const rawCustName = inv?.customerName || (c ? c.name : 'Customer #' + inv?.customerId);
        const custLines = this.wrapText(rawCustName, width - 4);
        custLines.forEach(line => {
          builder.appendText(this.boxLine(line, width) + "\n");
        });

        if (isOptionEnabled('Print Customer Tel') && c?.phone) {
          builder.appendText(this.boxLine(`TEL: ${c.phone}`, width) + "\n");
        }

        if (isOptionEnabled('Print Customer Add')) {
          const addr = getCustomerFullAddress(inv?.customerId);
          if (addr) {
            const addrLines = this.wrapText(addr, width - 4);
            addrLines.forEach(line => {
              builder.appendText(this.boxLine(line, width) + "\n");
            });
          }
        }

        builder.appendText("+" + "-".repeat(width - 2) + "+\n");
      }

      builder.appendText("-".repeat(width) + "\n");

      // 6. Items Table Header (Matching Live Preview columns)
      if (width === 48) {
        builder.appendText(this.formatRow("DESCRIPTION", "GST         SUBTOTAL", width) + "\n");
      } else {
        builder.appendText(this.formatRow("DESCRIPTION", "GST    SUBTOTAL", width) + "\n");
      }
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
        const fullDesc = `${i + 1}. ${prodName}${uom}`;
        const taxTag = `[${item.taxType || 'SR'}]`;

        // Check if description + tax fits on one line
        if (fullDesc.length + 1 + taxTag.length <= width) {
          builder.appendText(this.formatRow(fullDesc, taxTag, width) + "\n");
        } else {
          // Wrap description so taxTag fits on the last line or its own line
          const maxDescWidth = width - taxTag.length - 1;
          const wrapped = this.wrapText(fullDesc, maxDescWidth);
          if (wrapped.length > 1) {
            for (let j = 0; j < wrapped.length - 1; j++) {
              builder.appendText(wrapped[j] + "\n");
            }
            builder.appendText(this.formatRow('   ' + wrapped[wrapped.length - 1], taxTag, width) + "\n");
          } else {
            const fullWrapped = this.wrapText(fullDesc, width);
            if (fullWrapped.length > 1) {
              for (let j = 0; j < fullWrapped.length - 1; j++) {
                builder.appendText(fullWrapped[j] + "\n");
              }
              builder.appendText(this.formatRow('   ' + fullWrapped[fullWrapped.length - 1], taxTag, width) + "\n");
            } else {
              builder.appendText(fullWrapped[0] + "\n");
              builder.appendText(this.formatRow('', taxTag, width) + "\n");
            }
          }
        }

        // Calculation row: "   40 x 5.00              200.00" (Matching Live Preview: no RM prefix on subtotal)
        const qtyStr = `   ${item.quantity} x ${(item.unitPrice || 0).toFixed(2)}`;
        const subtotal = ((item.quantity || 0) * (item.unitPrice || 0)).toFixed(2);
        builder.appendText(this.formatRow(qtyStr, subtotal, width) + "\n");

        if (isOptionEnabled('Print Product Barcode')) {
          const product = products.find(p => p.id == item.productId);
          const barcode = item.barcode || product?.barcode || '';
          if (barcode) {
            builder.appendText(`   Barcode: ${barcode}\n`);
          }
        }

        if (item.remark) {
          builder.appendText(`   * ${item.remark}\n`);
        }
      });

      builder.appendText("-".repeat(width) + "\n");

      // 8. Financial Summary
      builder.appendText(this.formatRow("GROSS TOTAL", `RM ${(inv?.totalAmount || 0).toFixed(2)}`, width) + "\n");
      builder.appendText(this.formatRow("TAX TOTAL", `RM ${pd?.taxTotal || '0.00'}`, width) + "\n");

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

      // Net Amount (BOLD + Double height with banner border matching Live Preview dark card)
      const netAmount = getReceiptNetAmount();
      builder.appendText("=".repeat(width) + "\n");
      builder.append(CMD_BOLD_ON);
      builder.append(CMD_DOUBLE_HEIGHT);
      builder.appendText(this.formatRow("NET AMOUNT", `RM ${netAmount.toFixed(2)}`, width) + "\n");
      builder.append(CMD_NORMAL_SIZE);
      builder.append(CMD_BOLD_OFF);
      builder.appendText("=".repeat(width) + "\n");

      // Payment Details Box
      const paymentStatus = inv?.status === 'Paid' ? 'PAID' : inv?.status === 'Partial' ? 'PARTIALLY PAID' : 'UNPAID';
      builder.appendText(this.formatRow("PAYMENT STATUS", paymentStatus, width) + "\n");

      builder.appendText("+" + "-".repeat(width - 2) + "+\n");
      const displayedPaid = (inv?.paidAmount || 0) + totalChange;
      const paidLabel = "PAID AMOUNT (RECEIVED)";
      builder.appendText(this.boxLine(this.formatRow(paidLabel, `RM ${displayedPaid.toFixed(2)}`, width - 4), width) + "\n");

      if (totalChange > 0) {
        builder.appendText(this.boxLine(this.formatRow("CHANGE AS CREDIT", `+ RM ${totalChange.toFixed(2)}`, width - 4), width) + "\n");
      }

      const balance = getReceiptBalance();
      builder.appendText(this.boxLine(this.formatRow("BALANCE", `RM ${balance.toFixed(2)}`, width - 4), width) + "\n");
      builder.appendText("+" + "-".repeat(width - 2) + "+\n");

      // Transaction CN breakdown details
      if (cns.length > 0) {
        builder.appendText("-".repeat(width) + "\n");
        builder.appendText("TRANSACTION DETAILS:\n");
        cns.forEach((cn: any) => {
          builder.appendText(` * ${cn.cnNumber || 'CN-' + cn.id}\n`);
          builder.appendText(this.formatRow("   Refund Amount", `- RM ${(cn.amount || 0).toFixed(2)}`, width) + "\n");
          if (cn.items && cn.items.length > 0) {
            cn.items.forEach((cni: any) => {
              builder.appendText(`     • ${cni.productName} (${cni.quantity}x${cni.unitPrice.toFixed(2)})\n`);
            });
          }
        });
      }

      // 9. Due Date (Framed card matching Live Preview)
      if (isOptionEnabled('Print Term Date')) {
        const invoiceDate = inv?.invoiceDate ? new Date(inv.invoiceDate) : new Date();
        const dueStr = pd?.paymentDue || invoiceDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
        builder.appendText("\n");
        builder.appendText("+" + "-".repeat(width - 2) + "+\n");
        builder.appendText(this.boxCenterLine("PAYMENT DUE", width) + "\n");
        builder.appendText(this.boxCenterLine(dueStr, width) + "\n");
        builder.appendText("+" + "-".repeat(width - 2) + "+\n");
      }

      // 10. Signature Boxes (Framed card matching Live Preview)
      const showCashSig = inv?.termType === 'CASH SALE' && isOptionEnabled('Sign on Cash Invoice');
      const showCreditSig = inv?.termType === 'On Credit' && isOptionEnabled('Sign on Credit Invoice');
      const showCNSig = (totalReturns > 0) && isOptionEnabled('Sign on Credit Note');
      const showPaymentSig = (inv?.paidAmount > 0) && isOptionEnabled('Sign on Payment');

      if (showCashSig || showCreditSig || showCNSig || showPaymentSig) {
        const sigLabelText = inv?.termType === 'CASH SALE' && isOptionEnabled('Sign on Cash Invoice') ? 'CASH RECEIVED SIGNATURE' :
          inv?.termType === 'On Credit' && isOptionEnabled('Sign on Credit Invoice') ? 'CREDIT RECEIVED SIGNATURE' :
          totalReturns > 0 && isOptionEnabled('Sign on Credit Note') ? 'CREDIT NOTE RECEIVED SIGNATURE' :
          inv?.paidAmount > 0 && isOptionEnabled('Sign on Payment') ? 'PAYMENT RECEIVED SIGNATURE' : 'SIGNATURE';

        builder.appendText("\n");
        builder.appendText("+" + "-".repeat(width - 2) + "+\n");
        builder.appendText(this.boxLine("", width) + "\n");
        builder.appendText(this.boxLine("", width) + "\n");
        builder.appendText(this.boxCenterLine(sigLabelText, width) + "\n");
        builder.appendText("+" + "-".repeat(width - 2) + "+\n");
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

      return builder.getBuffer();
  }

  printPayment(pd: any, settings: any, customers: any[], products: any[]): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.isAvailable()) {
        this.alertService.toast('Bluetooth printing is only available on native devices (APK)', 'error');
        return resolve(false);
      }
      if (this.isPrinting) {
        this.alertService.toast('Printing in progress, please wait...', 'warning');
        return resolve(false);
      }

      const mac = settings.macAddress || '02:29:DE:43:D8:2C';
      this.checkPermission(
        () => {
          try {
            const buffer = this.buildPaymentBuffer(pd, settings, customers, products);
            this.executePrintJob(mac, buffer, 'Receipt', settings, resolve);
          } catch (e: any) {
            this.isPrinting = false;
            this.alertService.toast(`Format error: ${e.message}`, 'error');
            resolve(false);
          }
        },
        () => resolve(false)
      );
    });
  }

  private buildPaymentBuffer(pd: any, settings: any, customers: any[], products: any[]): ArrayBuffer {
    const { width } = this.resolvePrintWidth(settings);
    const builder = new BufferBuilder();

      const ESC = 0x1B;
      const GS = 0x1D;
      const FS = 0x1C;

      const CMD_INIT = [ESC, 0x40];
      const CMD_CANCEL_CHINESE = [FS, 0x2E];
      const CMD_ALIGN_LEFT = [ESC, 0x61, 0x00];
      const CMD_ALIGN_CENTER = [ESC, 0x61, 0x01];
      const CMD_BOLD_ON = [ESC, 0x45, 0x01];
      const CMD_BOLD_OFF = [ESC, 0x45, 0x00];
      const CMD_DOUBLE_HEIGHT = [GS, 0x21, 0x01];
      const CMD_NORMAL_SIZE = [GS, 0x21, 0x00];

      const getCustomer = (id: any) => customers.find((c: any) => c.id == id);
      const isOptionEnabled = (name: string): boolean => {
        if (!settings.contentOptions) return true;
        const opt = settings.contentOptions.find((o: any) => o.name === name);
        return opt ? opt.enabled : true;
      };

      builder.append(CMD_INIT);
      builder.append(CMD_CANCEL_CHINESE);

      // Title
      builder.appendText("\n");
      builder.append(CMD_ALIGN_CENTER);
      builder.appendText("OFFICIAL RECEIPT\n");
      builder.append(CMD_ALIGN_LEFT);
      builder.appendText("-".repeat(width) + "\n");

      // Company Info
      if (isOptionEnabled('Print Company Logo')) {
        builder.append(CMD_ALIGN_CENTER);
        builder.append(CMD_BOLD_ON);
        builder.append(CMD_DOUBLE_HEIGHT);
        builder.appendText("B JAYA TRADING\n");
        builder.append(CMD_NORMAL_SIZE);
        builder.append(CMD_BOLD_OFF);
        const headerWrapWidth = width <= 40 ? 30 : 44;
        builder.appendText("(001188861-T)\n");
        this.wrapText("NO. 467, JALAN PALAS 13, TAMAN PELANGI,", headerWrapWidth).forEach(line => {
          builder.appendText(line.trim() + "\n");
        });
        this.wrapText("70400 SEREMBAN N.S, MALAYSIA", headerWrapWidth).forEach(line => {
          builder.appendText(line.trim() + "\n");
        });
        builder.appendText("TEL: 012-6988080\n");
        builder.append(CMD_ALIGN_LEFT);
        builder.appendText("-".repeat(width) + "\n");
      }

      // Receipt Meta
      builder.appendText(`RECEIPT NO: ${pd.receiptNumber || 'RCPT-' + pd.id}\n`);
      const invNo = formatDocNo(pd.invoice || pd.invoiceNumber);
      builder.appendText(`INVOICE NO: ${invNo}\n`);
      if (isOptionEnabled('Print Issue Time')) {
        const payDate = pd.paymentDate ? new Date(pd.paymentDate) : new Date();
        const dateStr = payDate.toLocaleDateString('en-GB', {
          day: '2-digit',
          month: width <= 40 ? 'short' : 'long',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
        builder.appendText(`DATE      : ${dateStr}\n`);
      }

      // Customer Info (Framed box)
      if (isOptionEnabled('Print Customer Tel') || isOptionEnabled('Print Customer Add')) {
        const c = getCustomer(pd.customer?.id);
        builder.appendText("\nTO:\n");
        builder.appendText("+" + "-".repeat(width - 2) + "+\n");
        const custName = pd.customer?.name || '';
        this.wrapText(custName, width - 4).forEach(line => {
          builder.appendText(this.boxLine(line, width) + "\n");
        });
        if (isOptionEnabled('Print Customer Tel') && pd.customer?.phone) {
          builder.appendText(this.boxLine(`TEL: ${pd.customer?.phone}`, width) + "\n");
        }
        builder.appendText("+" + "-".repeat(width - 2) + "+\n");
      }

      builder.appendText("-".repeat(width) + "\n");

      // Items Table Header
      builder.appendText(this.formatRow("DESCRIPTION", "SUBTOTAL", width) + "\n");
      builder.appendText("-".repeat(width) + "\n");

      // Items List
      const items = pd.invoice?.items || [];
      items.forEach((item: any, i: number) => {
        let codeStr = '';
        if (isOptionEnabled('Print Item Code')) {
          const product = products.find(p => p.id == item.productId);
          const code = item.productCode || product?.productCode || product?.code || '';
          if (code) {
            codeStr = `[${code}] `;
          }
        }
        const descRow = `${i + 1}. ${codeStr}${item.productName}`;
        this.wrapText(descRow, width).forEach(line => {
          builder.appendText(line + "\n");
        });

        const qtyStr = `   ${item.quantity} x ${(item.unitPrice || 0).toFixed(2)}`;
        const subtotal = (item.total || 0).toFixed(2);
        builder.appendText(this.formatRow(qtyStr, subtotal, width) + "\n");

        if (isOptionEnabled('Print Product Barcode')) {
          const product = products.find(p => p.id == item.productId);
          const barcode = item.barcode || product?.barcode || '';
          if (barcode) {
            builder.appendText(`   Barcode: ${barcode}\n`);
          }
        }
      });

      builder.appendText("-".repeat(width) + "\n");

      // Payment Method
      builder.appendText(this.formatRow("PAYMENT METHOD", pd.paymentMethod || '', width) + "\n");
      if (pd.referenceNo) {
        builder.appendText(this.formatRow("REFERENCE NO", pd.referenceNo, width) + "\n");
      }
      builder.appendText(this.formatRow("INVOICE TOTAL", `RM ${(pd.invoice?.totalAmount || 0).toFixed(2)}`, width) + "\n");
      builder.appendText(this.formatRow("INVOICE BALANCE", `RM ${(pd.invoice?.balance || 0).toFixed(2)}`, width) + "\n");

      // Net Amount (BOLD)
      builder.appendText("=".repeat(width) + "\n");
      builder.append(CMD_BOLD_ON);
      builder.append(CMD_DOUBLE_HEIGHT);
      builder.appendText(this.formatRow("PAYMENT RECEIVED", `RM ${(pd.paymentAmount || 0).toFixed(2)}`, width) + "\n");
      builder.append(CMD_NORMAL_SIZE);
      builder.append(CMD_BOLD_OFF);
      builder.appendText("=".repeat(width) + "\n");

      // Signature Box
      if (isOptionEnabled('Sign on Payment')) {
        builder.appendText("\n");
        builder.appendText("+" + "-".repeat(width - 2) + "+\n");
        builder.appendText(this.boxLine("", width) + "\n");
        builder.appendText(this.boxLine("", width) + "\n");
        builder.appendText(this.boxCenterLine("PAYMENT RECEIVED SIGNATURE", width) + "\n");
        builder.appendText("+" + "-".repeat(width - 2) + "+\n");
      }

      // Footer
      if (isOptionEnabled('Footer')) {
        builder.appendText("\n");
        builder.append(CMD_ALIGN_CENTER);
        builder.appendText("THANK YOU\n");
        builder.append(CMD_ALIGN_LEFT);
      }

      return builder.getBuffer();
  }

  printCreditNote(cn: any, settings: any, customers: any[], products: any[]): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.isAvailable()) {
        this.alertService.toast('Bluetooth printing is only available on native devices (APK)', 'error');
        return resolve(false);
      }
      if (this.isPrinting) {
        this.alertService.toast('Printing in progress, please wait...', 'warning');
        return resolve(false);
      }

      const mac = settings.macAddress || '02:29:DE:43:D8:2C';
      this.checkPermission(
        () => {
          try {
            const buffer = this.buildCNBuffer(cn, settings, customers, products);
            this.executePrintJob(mac, buffer, 'Credit Note', settings, resolve);
          } catch (e: any) {
            this.isPrinting = false;
            this.alertService.toast(`Format error: ${e.message}`, 'error');
            resolve(false);
          }
        },
        () => resolve(false)
      );
    });
  }

  private buildCNBuffer(cn: any, settings: any, customers: any[], products: any[]): ArrayBuffer {
    const { width } = this.resolvePrintWidth(settings);
    const builder = new BufferBuilder();

      const ESC = 0x1B;
      const GS = 0x1D;
      const FS = 0x1C;

      const CMD_INIT = [ESC, 0x40];
      const CMD_CANCEL_CHINESE = [FS, 0x2E];
      const CMD_ALIGN_LEFT = [ESC, 0x61, 0x00];
      const CMD_ALIGN_CENTER = [ESC, 0x61, 0x01];
      const CMD_BOLD_ON = [ESC, 0x45, 0x01];
      const CMD_BOLD_OFF = [ESC, 0x45, 0x00];
      const CMD_DOUBLE_HEIGHT = [GS, 0x21, 0x01];
      const CMD_NORMAL_SIZE = [GS, 0x21, 0x00];

      const getCustomer = (id: any) => customers.find((c: any) => c.id == id || c.id == cn.customerId);
      const getProductName = (id: any) => {
        const p = products.find((x: any) => x.id == id);
        return p ? p.name : 'Product #' + id;
      };
      const isOptionEnabled = (name: string): boolean => {
        if (!settings.contentOptions) return true;
        const opt = settings.contentOptions.find((o: any) => o.name === name);
        return opt ? opt.enabled : true;
      };

      builder.append(CMD_INIT);
      builder.append(CMD_CANCEL_CHINESE);

      builder.appendText("\n");
      builder.append(CMD_ALIGN_CENTER);
      builder.appendText("CREDIT NOTE\n");
      builder.append(CMD_ALIGN_LEFT);
      builder.appendText("-".repeat(width) + "\n");

      if (isOptionEnabled('Print Company Logo')) {
        builder.append(CMD_ALIGN_CENTER);
        builder.append(CMD_BOLD_ON);
        builder.append(CMD_DOUBLE_HEIGHT);
        builder.appendText("B JAYA TRADING\n");
        builder.append(CMD_NORMAL_SIZE);
        builder.append(CMD_BOLD_OFF);
        const headerWrapWidth = width <= 40 ? 30 : 44;
        builder.appendText("(001188861-T)\n");
        this.wrapText("NO. 467, JALAN PALAS 13, TAMAN PELANGI,", headerWrapWidth).forEach(line => {
          builder.appendText(line.trim() + "\n");
        });
        this.wrapText("70400 SEREMBAN N.S, MALAYSIA", headerWrapWidth).forEach(line => {
          builder.appendText(line.trim() + "\n");
        });
        builder.appendText("TEL: 012-6988080\n");
        builder.append(CMD_ALIGN_LEFT);
        builder.appendText("-".repeat(width) + "\n");
      }

      builder.appendText(`CN NO  : ${cn.cnNumber || 'CN-' + cn.id}\n`);
      const cnInvNo = formatDocNo(cn.invoiceNumber || cn);
      builder.appendText(`INV NO : ${cnInvNo}\n`);
      if (isOptionEnabled('Print Issue Time')) {
        const cnDate = cn.createdAt ? new Date(cn.createdAt) : new Date();
        const dateStr = cnDate.toLocaleDateString('en-GB', {
          day: '2-digit',
          month: width <= 40 ? 'short' : 'long',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
        builder.appendText(`DATE   : ${dateStr}\n`);
      }

      if (isOptionEnabled('Print Customer Tel') || isOptionEnabled('Print Customer Add')) {
        builder.appendText("\nTO:\n");
        builder.appendText("+" + "-".repeat(width - 2) + "+\n");
        const c = getCustomer(cn.customerId);
        const custName = cn.customerName || (c ? c.name : 'Customer');
        this.wrapText(custName, width - 4).forEach(line => {
          builder.appendText(this.boxLine(line, width) + "\n");
        });
        if (isOptionEnabled('Print Customer Tel') && (cn.customerPhone || c?.phone)) {
          builder.appendText(this.boxLine(`TEL: ${cn.customerPhone || c.phone}`, width) + "\n");
        }
        builder.appendText("+" + "-".repeat(width - 2) + "+\n");
      }

      builder.appendText("-".repeat(width) + "\n");
      builder.appendText(this.formatRow("DESCRIPTION", "SUBTOTAL", width) + "\n");
      builder.appendText("-".repeat(width) + "\n");

      const items = cn.Items || cn.items || [];
      items.forEach((item: any, i: number) => {
        let prodName = item.productName || item.Name || getProductName(item.productId);
        if (isOptionEnabled('Print Item Code')) {
          const product = products.find(p => p.id == item.productId);
          const code = item.productCode || product?.productCode || product?.code || '';
          if (code) prodName = `[${code}] ${prodName}`;
        }
        const uom = isOptionEnabled('Print Item U.O.M.') ? ` (${item.uom || 'UNIT'})` : '';
        const fullDesc = `${i + 1}. ${prodName}${uom}`;
        this.wrapText(fullDesc, width).forEach(line => {
          builder.appendText(line + "\n");
        });

        const qtyStr = `   ${item.quantity} x ${(item.unitPrice || 0).toFixed(2)}`;
        const subtotal = ((item.quantity || 0) * (item.unitPrice || 0)).toFixed(2);
        builder.appendText(this.formatRow(qtyStr, subtotal, width) + "\n");

        if (isOptionEnabled('Print Product Barcode')) {
          const product = products.find(p => p.id == item.productId);
          const barcode = item.barcode || product?.barcode || '';
          if (barcode) builder.appendText(`   Barcode: ${barcode}\n`);
        }
      });

      builder.appendText("-".repeat(width) + "\n");
      builder.appendText(this.formatRow("REFUND AMOUNT", `RM ${(cn.amount || 0).toFixed(2)}`, width) + "\n");
      if (cn.reason) {
        builder.appendText(`Reason: ${cn.reason}\n`);
      }
      const status = cn.isUsed ? 'CREDIT USED' : cn.createdAfterPayment ? 'CREDIT ACTIVE' : 'DEBT OFFSET';
      builder.appendText(this.formatRow("STATUS", status, width) + "\n");
      builder.appendText("-".repeat(width) + "\n");

      if (isOptionEnabled('Sign on Credit Note')) {
        builder.appendText("\n");
        builder.appendText("+" + "-".repeat(width - 2) + "+\n");
        builder.appendText(this.boxLine("", width) + "\n");
        builder.appendText(this.boxLine("", width) + "\n");
        builder.appendText(this.boxCenterLine("CREDIT NOTE RECEIVED SIGNATURE", width) + "\n");
        builder.appendText("+" + "-".repeat(width - 2) + "+\n");
      }

      if (isOptionEnabled('Footer')) {
        builder.appendText("\n");
        builder.append(CMD_ALIGN_CENTER);
        builder.appendText("THANK YOU\n");
        builder.append(CMD_ALIGN_LEFT);
      }

      const emptyLines = settings.bottomEmptyLine ?? 5;
      builder.appendText("\n".repeat(emptyLines));
      return builder.getBuffer();
  }
}

/** Helper class to build ESC/POS payload ensuring 100% safe ASCII encoding */
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
    const clean = sanitizePrintText(text);
    // Convert to strict single-byte ASCII (0..127) so printer never enters multi-byte Chinese mode
    const bytes = new Uint8Array(clean.length);
    for (let i = 0; i < clean.length; i++) {
      const code = clean.charCodeAt(i);
      bytes[i] = code < 128 ? code : 0x20;
    }
    this.chunks.push(bytes);
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
