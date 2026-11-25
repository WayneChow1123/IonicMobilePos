import { TestBed } from '@angular/core/testing';
import { OfflineActivityComponent } from './offline-activity.component';

describe('Offline activity modal', () => {
  it('shows a readable payment name for existing journal entries without exposing queue IDs', async () => {
    await TestBed.configureTestingModule({ imports: [OfflineActivityComponent] }).compileComponents();
    const fixture = TestBed.createComponent(OfflineActivityComponent);
    fixture.componentInstance.activities = [{ id: 'a', taskId: 'pay_bulk_secret', type: 'CREATE_BULK_PAYMENT',
      createdAt: Date.now(), status: 'pending', reference: 'pay_bulk_secret', customer: 'Customer A',
      details: ['Invoice INV-123: RM 5.20'] }];
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Payment received');
    expect(text).toContain('Customer A');
    expect(text).toContain('INV-123: RM 5.20');
    expect(text).not.toContain('pay_bulk_secret');
    fixture.destroy();
  });
  it('shows CRUD history, filters rows and only syncs when Sync Now is pressed', async () => {
    await TestBed.configureTestingModule({ imports: [OfflineActivityComponent] }).compileComponents();
    const fixture = TestBed.createComponent(OfflineActivityComponent);
    const component = fixture.componentInstance;
    component.activities = [
      { id: 'a', taskId: 'a', type: 'CREATE_INVOICE', createdAt: Date.now(), status: 'pending', reference: 'INV-A', customer: 'Customer A', details: ['Amount: RM 100.00'] },
      { id: 'b', taskId: 'b', type: 'DELETE_INVOICE', createdAt: Date.now(), status: 'synced', reference: 'INV-B', customer: '', details: [] }
    ];
    component.pendingCount = 1;
    const sync = spyOn(component.syncNow, 'emit');
    const close = spyOn(component.close, 'emit');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.offline-log-card').length).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('Created Invoice');
    expect(fixture.nativeElement.textContent).toContain('Deleted Invoice');
    expect(sync).not.toHaveBeenCalled();
    fixture.nativeElement.querySelectorAll('.offline-log-filters button')[1].click(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.offline-log-card').length).toBe(1);
    fixture.nativeElement.querySelector('.offline-log-actions button').click();
    expect(sync).toHaveBeenCalledTimes(1);
    component.syncing = true; fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.offline-log-actions button').disabled).toBeTrue();
    fixture.nativeElement.querySelector('ion-button').click();
    expect(close).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });
});
