import { ComponentFixture, TestBed } from '@angular/core/testing';
import { InvoicesPage } from './invoices.page';

describe('InvoicesPage', () => {
  let component: InvoicesPage;
  let fixture: ComponentFixture<InvoicesPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(InvoicesPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
