import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AccountService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  register(name: string, phoneNumber: string) {
    return this.http.post<{ success: boolean; account: AccountProfile }>(
      `${this.apiUrl}/account/register`,
      { name, phoneNumber }
    );
  }

  getProfile() {
    return this.http.get<{ success: boolean; account: AccountProfile }>(
      `${this.apiUrl}/account/me`
    );
  }

  getTransactions() {
    return this.http.get<{ success: boolean; transactions: WalletTransaction[] }>(
      `${this.apiUrl}/account/transactions`
    );
  }

  getHistory() {
    return this.http.get<{ success: boolean; history: GenerationHistory[] }>(
      `${this.apiUrl}/account/history`
    );
  }

  getPackages() {
    return this.http.get<{
      success: boolean;
      packages: CoinPackage[];
      premium: { priceRupees: number; validityDays: number };
    }>(`${this.apiUrl}/payments/packages`);
  }

  createOrder(purchase: { type: 'COINS'; packageId: string } | { type: 'PREMIUM' }) {
    return this.http.post<PaymentOrder>(`${this.apiUrl}/payments/order`, purchase);
  }

  verifyPayment(payment: RazorpayPaymentResponse) {
    return this.http.post<{ success: boolean; paymentType: string; coins?: number }>(
      `${this.apiUrl}/payments/verify`,
      payment
    );
  }

  getAdminStats() {
    return this.http.get<{ success: boolean; stats: {
      registeredUsers: number;
      capturedPayments: number;
      successfulGenerations: number;
    } }>(`${this.apiUrl}/admin/stats`);
  }

  getAdminUsers() {
    return this.http.get<{ success: boolean; users: AdminUser[] }>(
      `${this.apiUrl}/admin/users`
    );
  }

  getAdminPayments() {
    return this.http.get<{ success: boolean; payments: AdminPayment[] }>(
      `${this.apiUrl}/admin/payments`
    );
  }

  adjustUserCoins(userId: string, amount: number, reason: string) {
    return this.http.post<{ success: boolean; message: string }>(
      `${this.apiUrl}/admin/users/${encodeURIComponent(userId)}/coins`,
      { amount, reason }
    );
  }

  saveCoinPackages(packages: CoinPackage[]) {
    return this.http.put<{ success: boolean; packages: CoinPackage[] }>(
      `${this.apiUrl}/admin/coin-packages`,
      { packages }
    );
  }
}

export interface AccountProfile {
  id: string;
  name: string;
  phoneNumber: string;
  coins: number;
  totalClipsGenerated: number;
  coinsUsed: number;
  isPremium: boolean;
  subscriptionExpiry: string | null;
  premiumExpired: boolean;
  createdAt: string;
}

export interface WalletTransaction {
  id: string;
  type: string;
  amount: number;
  reason: string;
  status?: string;
  currency?: string;
  createdAt: string;
}

export interface GenerationHistory {
  id: string;
  status: string;
  premium: boolean;
  charge: number;
  clipCount: number;
  jobId: string;
  expiresAt: string | null;
  clipDetails: Array<{
    filename: string;
    duration: number;
    start: number;
    end: number;
    interestScore: number;
  }>;
  createdAt: string;
  completedAt: string;
}

export interface CoinPackage {
  id: string;
  coins: number;
  priceRupees: number;
  label: string;
}

export interface AdminUser {
  id: string;
  name: string;
  phoneNumber: string;
  coins: number;
  totalClipsGenerated: number;
  isPremium: boolean;
  subscriptionExpiry: string | null;
  createdAt: string;
}

export interface AdminPayment {
  id: string;
  userId: string;
  razorpayOrderId: string;
  amount: number;
  currency: string;
  paymentType: string;
  status: string;
  createdAt: string;
}

export interface PaymentOrder {
  success: boolean;
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
  paymentType: string;
  package: CoinPackage | null;
}

export interface RazorpayPaymentResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}
