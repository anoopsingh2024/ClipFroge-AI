import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  AccountService,
  AdminPayment,
  AdminUser,
  CoinPackage
} from '../../services/account';
import { FirebaseAuthService } from '../../services/firebase-auth';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './admin.html',
  styleUrl: './admin.scss'
})
export class AdminPage implements OnInit {
  stats = { registeredUsers: 0, capturedPayments: 0, successfulGenerations: 0 };
  users: AdminUser[] = [];
  payments: AdminPayment[] = [];
  packages: CoinPackage[] = [];
  selectedUserId = '';
  adjustmentAmount = 10;
  adjustmentReason = '';
  busy = false;
  errorMessage = '';
  successMessage = '';

  constructor(
    private accounts: AccountService,
    private firebase: FirebaseAuthService,
    private router: Router
  ) {}

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.busy = true;
    this.errorMessage = '';
    try {
      const [stats, users, payments, packages] = await Promise.all([
        firstValueFrom(this.accounts.getAdminStats()),
        firstValueFrom(this.accounts.getAdminUsers()),
        firstValueFrom(this.accounts.getAdminPayments()),
        firstValueFrom(this.accounts.getPackages())
      ]);
      this.stats = stats.stats;
      this.users = users.users;
      this.payments = payments.payments;
      this.packages = packages.packages.map(item => ({ ...item }));
      if (!this.selectedUserId && this.users.length) this.selectedUserId = this.users[0].id;
    } catch (error) {
      this.errorMessage = error instanceof HttpErrorResponse && error.status === 403
        ? 'This Firebase account is not authorized for admin access. Add its UID to backend ADMIN_UIDS.'
        : error instanceof HttpErrorResponse
          ? error.error?.message || 'Admin dashboard could not be loaded.'
          : error instanceof Error ? error.message : 'Admin dashboard could not be loaded.';
    } finally {
      this.busy = false;
    }
  }

  async adjustCoins(): Promise<void> {
    if (this.busy || !this.selectedUserId) return;
    this.busy = true;
    this.errorMessage = '';
    this.successMessage = '';
    try {
      const result = await firstValueFrom(this.accounts.adjustUserCoins(
        this.selectedUserId,
        Number(this.adjustmentAmount),
        this.adjustmentReason
      ));
      this.successMessage = result.message;
      this.adjustmentReason = '';
      await this.load();
    } catch (error) {
      this.errorMessage = this.describeError(error);
    } finally {
      this.busy = false;
    }
  }

  async savePackages(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.errorMessage = '';
    this.successMessage = '';
    try {
      const result = await firstValueFrom(this.accounts.saveCoinPackages(this.packages));
      this.packages = result.packages.map(item => ({ ...item }));
      this.successMessage = 'Coin package prices saved.';
    } catch (error) {
      this.errorMessage = this.describeError(error);
    } finally {
      this.busy = false;
    }
  }

  async logout(): Promise<void> {
    await this.firebase.logout();
    await this.router.navigate(['/']);
  }

  formatDate(value: string): string {
    return new Date(value).toLocaleString();
  }

  private describeError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      return error.error?.message || 'Admin operation failed.';
    }
    return error instanceof Error ? error.message : 'Admin operation failed.';
  }
}
