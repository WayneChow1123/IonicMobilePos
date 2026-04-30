import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ApiService {

  private baseUrl = 'http://localhost:5262';

  constructor(private http: HttpClient) {}

  getFullBackup(): Observable<any> { return this.http.get(this.baseUrl + '/api/backup/full'); }
  getIncrementBackup(): Observable<any> { return this.http.get(this.baseUrl + '/api/backup/increment'); }
  downloadBackup(id: string): Observable<any> { return this.http.get(this.baseUrl + '/api/backup/download/' + id); }

  createCategory(data: any): Observable<any> { return this.http.post(this.baseUrl + '/Category/CreateCategory/createcategory', data); }
  getCategories(): Observable<any> { return this.http.get(this.baseUrl + '/Category/GetCategories/categories'); }
  editCategory(id: any, data: any): Observable<any> { return this.http.put(this.baseUrl + '/Category/EditCategory/editcategory/' + id, data); }
  deleteCategory(id: any): Observable<any> { return this.http.delete(this.baseUrl + '/Category/DeleteCategory/deletecategory/' + id, { responseType: 'text' }); }

  createCreditNote(invoiceId: any, data: any): Observable<any> { return this.http.post(this.baseUrl + '/Credit/CreateCreditNote/invoices/' + invoiceId + '/credit-notes', data); }
  getCreditNotesByInvoice(invoiceId: any): Observable<any> { return this.http.get(this.baseUrl + '/Credit/GetCreditNotesByInvoice/invoices/' + invoiceId + '/credit-notes'); }
  getCreditNoteById(invoiceId: any, cnId: any): Observable<any> { return this.http.get(this.baseUrl + '/Credit/GetCreditNoteById/invoices/' + invoiceId + '/credit-notes/' + cnId); }
  getAvailableCredits(customerId: number): Observable<any> { return this.http.get(this.baseUrl + '/Credit/GetAvailableCredits/customers/' + customerId + '/available-credits'); }

  useCreditNote(invoiceId: number, cnId: number): Observable<any> { return this.http.patch(this.baseUrl + '/Credit/UseCreditNote/invoices/' + invoiceId + '/credit-notes/' + cnId + '/use', {}); }

  deleteCreditNote(invoiceId: any, cnId: any): Observable<any> { return this.http.delete(this.baseUrl + '/Credit/DeleteCreditNote/invoices/' + invoiceId + '/credit-notes/' + cnId, { responseType: 'text' }); }
  getAllCreditNotes(): Observable<any> { return this.http.get(this.baseUrl + '/Credit/GetAllCreditNotes/credit-notes/list'); }

  createCustomer(data: any): Observable<any> { return this.http.post(this.baseUrl + '/Customer/CreateCustomers/createcustomers', data); }
  getAllCustomers(): Observable<any> { return this.http.get(this.baseUrl + '/Customer/GetAllCustomer/getallcustomer'); }
  getCustomerById(id: any): Observable<any> { return this.http.get(this.baseUrl + '/Customer/GetCustomerById/getcustomersby/' + id); }
  editCustomer(id: any, data: any): Observable<any> { return this.http.put(this.baseUrl + '/Customer/EditCustomer/editcustomers/' + id, data); }
  deleteCustomer(id: any): Observable<any> { return this.http.delete(this.baseUrl + '/Customer/DeleteCustomer/deletecustomer/' + id, { responseType: 'text' }); }
  createCustomerProductPrice(customerId: any, data: any): Observable<any> { return this.http.post(this.baseUrl + '/Customer/CreateCustomerProductPrice/customers/' + customerId + '/product-prices', data); }
  updateCustomerProductPrice(customerId: any, productId: any, data: any): Observable<any> { return this.http.patch(this.baseUrl + '/Customer/UpdateCustomerProductPrice/customers/' + customerId + '/product-prices/' + productId, data); }
  deleteCustomerProductPrice(customerId: any, productId: any): Observable<any> { return this.http.delete(this.baseUrl + '/Customer/DeleteCustomerProductPrice/customers/' + customerId + '/product-prices/' + productId, { responseType: 'text' }); }

  createInvoice(data: any): Observable<any> { return this.http.post(this.baseUrl + '/Invoice/CreateInvoice/invoices', data); }
  getStockReadyInvoices(): Observable<any> { return this.http.get(this.baseUrl + '/Invoice/GetStockReadyInvoices/invoices/stock-ready'); }

  getInvoices(params?: any): Observable<any> { return this.http.get(this.baseUrl + '/Invoice/GetInvoices/invoices', { params }); }
  getInvoiceDetails(id: any): Observable<any> { return this.http.get(this.baseUrl + '/Invoice/GetInvoiceDetails/invoices/' + id); }
  updateInvoice(id: any, data: any): Observable<any> { return this.http.patch(this.baseUrl + '/Invoice/UpdateInvoice/invoices/' + id, data); }
  deleteInvoice(id: any): Observable<any> { return this.http.delete(this.baseUrl + '/Invoice/DeleteInvoice/invoices/' + id, { responseType: 'text' }); }
  previewInvoice(id: any): Observable<any> { return this.http.get(this.baseUrl + '/Invoice/PreviewInvoice/invoices/' + id + '/preview'); }

  createPayment(data: any): Observable<any> { return this.http.post(this.baseUrl + '/Payment/CreatePayment/payments', data); }
  getPayInfo(customerId: any, invoiceId: any): Observable<any> { return this.http.get(this.baseUrl + '/Payment/GetPayInfo/customers/' + customerId + '/invoices/' + invoiceId + '/pay-info'); }
  getPaymentPreview(id: any): Observable<any> { return this.http.get(this.baseUrl + '/Payment/GetPaymentPreview/payments/' + id + '/preview'); }
  getPayments(): Observable<any> { return this.http.get(this.baseUrl + '/Payment/GetPayments/payments'); }
  getPaymentById(id: any): Observable<any> { return this.http.get(this.baseUrl + '/Payment/GetPaymentById/payments/' + id); }
  deletePayment(id: any): Observable<any> { return this.http.delete(this.baseUrl + '/Payment/DeletePayment/payments/' + id, { responseType: 'text' }); }

  createProduct(data: any): Observable<any> { return this.http.post(this.baseUrl + '/Product/CreateProducts/createproducts', data); }
  getProducts(): Observable<any> { return this.http.get(this.baseUrl + '/Product/GetProducts/products'); }
  getProductById(id: any): Observable<any> { return this.http.get(this.baseUrl + '/Product/GetProductById/getproductsby/' + id); }
  editProduct(id: any, data: any): Observable<any> { return this.http.put(this.baseUrl + '/Product/EditProduct/editproduct/' + id, data); }
  deleteProduct(id: any): Observable<any> { return this.http.delete(this.baseUrl + '/Product/DeleteProduct/deleteproduct/' + id, { responseType: 'text' }); }
  activateProduct(id: any): Observable<any> { return this.http.patch(this.baseUrl + '/Product/ActivateProduct/activateproduct/' + id, {}); }
  deactivateProduct(id: any): Observable<any> { return this.http.patch(this.baseUrl + '/Product/DeactivateProduct/deactivateproduct/' + id, {}); }
  addStock(id: any, data: any): Observable<any> { return this.http.patch(this.baseUrl + '/Product/AddStock/addstock/' + id, data); }

  getBillReport(): Observable<any> { return this.http.get(this.baseUrl + '/Report/GetBillReport/reports/bill'); }
  getProductSalesReport(): Observable<any> { return this.http.get(this.baseUrl + '/Report/GetProductSalesReport/reports/product-sales'); }
  getCompanyReport(): Observable<any> { return this.http.get(this.baseUrl + '/Report/GetCompanyReport/reports/company'); }
  getInvoiceReport(): Observable<any> { return this.http.get(this.baseUrl + '/Report/GetInvoiceReport/reports/invoice'); }
  previewReport(reportType: string): Observable<any> { return this.http.get(this.baseUrl + '/Report/PreviewReport/reports/' + reportType + '/preview'); }

  setSystemPassword(data: any): Observable<any> { return this.http.post(this.baseUrl + '/System/SetSystemPassword/system/password', data); }
  updateSystemPassword(data: any): Observable<any> { return this.http.patch(this.baseUrl + '/System/UpdateSystemPassword/system/password', data); }
  getPrintSetting(): Observable<any> { return this.http.get(this.baseUrl + '/System/GetPrintSetting/system/print-setting'); }
}
