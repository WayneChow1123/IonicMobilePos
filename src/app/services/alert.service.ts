import { Injectable } from '@angular/core';
import Swal from 'sweetalert2';

@Injectable({
  providedIn: 'root'
})
export class AlertService {

  constructor() { }

  toast(title: string, icon: 'success' | 'error' | 'warning' | 'info' = 'success') {
    const Toast = Swal.mixin({
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 3000,
      timerProgressBar: true,
      didOpen: (toast) => {
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
    }).then((result) => {
      return result.isConfirmed;
    });
  }
}
