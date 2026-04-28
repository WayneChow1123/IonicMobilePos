import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PrinterSettingPage } from './printer-setting.page';

describe('PrinterSettingPage', () => {
  let component: PrinterSettingPage;
  let fixture: ComponentFixture<PrinterSettingPage>;

  beforeEach(async () => {
    fixture = TestBed.createComponent(PrinterSettingPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
