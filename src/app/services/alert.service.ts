import { Injectable } from '@angular/core';
import Swal from 'sweetalert2';

@Injectable({
  providedIn: 'root'
})
export class AlertService {

  constructor() { }

  toast(title: string, icon: 'success' | 'error' | 'warning' | 'info' = 'success') {
    // If the message is long, use a center Modal instead of a top-right Toast
    if (title && title.length > 60) {
      const isGiantError = title.length > 300;
      
      Swal.fire({
        icon: icon,
        title: icon === 'error' ? 'Oops...' : (icon === 'warning' ? 'Warning' : 'Info'),
        html: isGiantError 
          ? `<div style="max-height: 250px; overflow-y: auto; text-align: left; font-size: 12px; font-family: monospace; background: #f5f5f5; padding: 12px; border-radius: 8px; color: #d32f2f;">${title.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`
          : `<div style="text-align: center; font-size: 15px; color: #333;">${title.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`,
        confirmButtonColor: '#1a1a1a',
        confirmButtonText: 'OK',
        width: isGiantError ? '600px' : '400px'
      });
      return;
    }

    const Toast = Swal.mixin({
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 3000,
      timerProgressBar: true,
      didOpen: (toast: any) => {
        toast.onmouseenter = Swal.stopTimer;
        toast.onmouseleave = Swal.resumeTimer;
      }
    });

    Toast.fire({
      icon: icon,
      title: title
    });
  }

  confirm(title: string, text: string = "You won't be able to revert this!"): Promise<boolean> {
    return Swal.fire({
      title: title,
      text: text,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#e57373',
      cancelButtonColor: '#1a1a1a',
      confirmButtonText: 'Yes, delete it!'
    }).then((result: any) => {
      return result.isConfirmed;
    });
  }
}
