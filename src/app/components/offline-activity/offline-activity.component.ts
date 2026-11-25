import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import type { OfflineActivity } from '../../services/offline-storage.service';

@Component({ standalone: true, imports: [CommonModule, IonicModule], selector: 'app-offline-activity',
  templateUrl: './offline-activity.component.html', styleUrls: ['./offline-activity.component.scss'] })
export class OfflineActivityComponent {
  @Input() activities: OfflineActivity[] = [];
  @Input() pendingCount = 0;
  @Input() syncing = false;
  @Input() error = '';
  @Output() close = new EventEmitter<void>();
  @Output() syncNow = new EventEmitter<void>();
  filter: 'all' | 'pending' | 'synced' | 'failed' = 'all';
  get visibleActivities() {
    return this.activities.filter(row => this.filter === 'all' || row.status === this.filter);
  }

  activityReference(row: OfflineActivity): string {
    // Old journal entries also contain internal queue IDs. Keep those IDs in
    // storage for synchronization, but never use them as payment display names.
    if (row.type === 'CREATE_BULK_PAYMENT') return 'Payment received';
    if (row.type.includes('PAYMENT') && /^(pay_|payment_|[0-9a-f]{8}-)/i.test(row.reference || '')) return 'Payment';
    return row.reference;
  }

  offlineActivityTitle(type: string): string {
    const action = type.startsWith('CREATE_') ? 'Created' : type.startsWith('UPDATE_') ? 'Edited' : type.startsWith('DELETE_') ? 'Deleted' : '';
    const entity = type.includes('INVOICE') ? 'Invoice' : type.includes('CUSTOMER_PRICE') ? 'Special Price' : type.includes('CUSTOMER') ? 'Customer' :
      type.includes('CATEGORY') ? 'Category' : type.includes('PRODUCT') ? 'Product' : type.includes('PAYMENT') ? 'Payment' : type.includes('CN') ? 'Credit Note' : 'Record';
    return action ? `${action} ${entity}` : type.replace(/_/g, ' ').toLowerCase();
  }

  offlineActivityStatus(status: string): string {
    return ({ pending: 'Pending sync', failed: 'Sync failed', synced: 'Synced', cancelled: 'Cancelled pending task', local: 'Applied on this device' } as Record<string, string>)[status] || status;
  }

}
