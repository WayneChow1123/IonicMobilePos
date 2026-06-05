import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly AUTH_KEY = 'td_pos_logged_in';

  constructor() {}

  login(username: string, password: string): boolean {
    if (username === 'admin' && password === 'admin') {
      sessionStorage.setItem(this.AUTH_KEY, 'true');
      return true;
    }
    return false;
  }

  logout(): void {
    sessionStorage.removeItem(this.AUTH_KEY);
  }

  isLoggedIn(): boolean {
    return sessionStorage.getItem(this.AUTH_KEY) === 'true';
  }
}
