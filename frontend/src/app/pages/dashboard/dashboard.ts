import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  AccountProfile,
  AccountService,
  CoinPackage,
  GenerationHistory,
  PaymentOrder,
  RazorpayPaymentResponse,
  WalletTransaction
} from '../../services/account';
import { FirebaseAuthService } from '../../services/firebase-auth';

interface RazorpayCheckoutOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill: { name: string; contact: string };
  theme: { color: string };
  handler: (response: RazorpayPaymentResponse) => void;
  modal: { ondismiss: () => void };
}

interface RazorpayCheckout {
  open(): void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayCheckout;
  }
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss'
})
export class Dashboard implements OnInit {
  account: AccountProfile | null = null;
  packages: CoinPackage[] = [];
  transactions: WalletTransaction[] = [];
  history: GenerationHistory[] = [];
  premiumPrice = 100;
  premiumDays = 90;
  loading = true;
  checkoutBusy = false;
  errorMessage = '';
  successMessage = '';

  constructor(
    private accounts: AccountService,
    private firebase: FirebaseAuthService,
    private router: Router
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadDashboard();
  }

  async loadDashboard(): Promise<void> {
    this.loading = true;
    this.errorMessage = '';
    try {
      const [profile, transactions, history, packages] = await Promise.all([
        firstValueFrom(this.accounts.getProfile()),
        firstValueFrom(this.accounts.getTransactions()),
        firstValueFrom(this.accounts.getHistory()),
        firstValueFrom(this.accounts.getPackages())
      ]);
      this.account = profile.account;
      this.transactions = transactions.transactions;
      this.history = history.history;
      this.packages = packages.packages;
      this.premiumPrice = packages.premium.priceRupees;
      this.premiumDays = packages.premium.validityDays;
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 404) {
        this.errorMessage = 'This verified phone number does not have a ClipForge profile. Register to continue.';
        await this.firebase.logout();
        await this.router.navigate(['/auth'], { queryParams: { mode: 'register' } });
      } else {
        this.errorMessage = this.describeError(error);
      }
    } finally {
      this.loading = false;
    }
  }

  async buyCoins(pack: CoinPackage): Promise<void> {
    await this.beginCheckout({ type: 'COINS', packageId: pack.id });
  }

  async upgradePremium(): Promise<void> {
    await this.beginCheckout({ type: 'PREMIUM' });
  }

  async logout(): Promise<void> {
    await this.firebase.logout();
    await this.router.navigate(['/']);
  }

  formatDate(value: string | null | undefined): string {
    if (!value) return '—';
    return new Date(value).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  isPreviewAvailable(item: GenerationHistory): boolean {
    return Boolean(item.expiresAt && new Date(item.expiresAt).getTime() > Date.now());
  }

  previewUrl(item: GenerationHistory): string {
    const firstClip = item.clipDetails?.[0];
    if (!firstClip) return '';
    return `${environment.apiUrl}/videos/clip/${encodeURIComponent(item.jobId)}/${encodeURIComponent(firstClip.filename)}`;
  }

  private async beginCheckout(
    purchase: { type: 'COINS'; packageId: string } | { type: 'PREMIUM' }
  ): Promise<void> {
    if (this.checkoutBusy) return;
    this.errorMessage = '';
    this.successMessage = '';
    this.checkoutBusy = true;
    try {
      const order = await firstValueFrom(this.accounts.createOrder(purchase));
      await this.loadRazorpayScript();
      if (!window.Razorpay) throw new Error('Razorpay Checkout could not be loaded.');
      const options: RazorpayCheckoutOptions = {
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: 'ClipForge AI',
        description: order.paymentType === 'PREMIUM'
          ? `Premium · ${this.premiumDays} days`
          : `${order.package?.label || 'Coin package'}`,
        order_id: order.orderId,
        prefill: {
          name: this.account?.name || '',
          contact: this.account?.phoneNumber.replace(/^\+91/, '') || ''
        },
        theme: { color: '#8255e8' },
        handler: response => { void this.handlePaymentSuccess(response, order); },
        modal: { ondismiss: () => { this.checkoutBusy = false; } }
      };
      new window.Razorpay(options).open();
    } catch (error) {
      this.checkoutBusy = false;
      this.errorMessage = this.describeError(error);
    }
  }

  private async handlePaymentSuccess(
    payment: RazorpayPaymentResponse,
    order: PaymentOrder
  ): Promise<void> {
    this.errorMessage = '';
    try {
      const result = await firstValueFrom(this.accounts.verifyPayment(payment));
      this.successMessage = result.paymentType === 'PREMIUM'
        ? `Premium is active for ${this.premiumDays} days.`
        : `${result.coins || order.package?.coins || 0} coins were added to your wallet.`;
      await this.loadDashboard();
    } catch (error) {
      this.errorMessage = this.describeError(error);
    } finally {
      this.checkoutBusy = false;
    }
  }

  private loadRazorpayScript(): Promise<void> {
    if (window.Razorpay) return Promise.resolve();
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://checkout.razorpay.com/v1/checkout.js"]'
    );
    if (existing) {
      return new Promise((resolve, reject) => {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('Razorpay Checkout failed to load.')), { once: true });
      });
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Razorpay Checkout failed to load.'));
      document.head.appendChild(script);
    });
  }

  private describeError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      return error.error?.message || 'Request failed. Please try again.';
    }
    return error instanceof Error ? error.message : 'Something went wrong.';
  }
}
