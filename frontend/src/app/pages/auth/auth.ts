import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ConfirmationResult } from 'firebase/auth';
import { AccountService } from '../../services/account';
import { FirebaseAuthService } from '../../services/firebase-auth';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './auth.html',
  styleUrl: './auth.scss'
})
export class AuthPage implements OnInit, OnDestroy {
  registerMode = false;
  fullName = '';
  phoneNumber = '';
  otp = '';
  confirmation: ConfirmationResult | null = null;
  cooldownSeconds = 0;
  verificationAttempts = 0;
  busy = false;
  errorMessage = '';
  infoMessage = '';
  private cooldownTimer: ReturnType<typeof setInterval> | null = null;
  private returnUrl = '/dashboard';

  constructor(
    readonly firebase: FirebaseAuthService,
    private accounts: AccountService,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.registerMode = this.route.snapshot.queryParamMap.get('mode') === 'register';
    this.returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/dashboard';
    if (!this.firebase.isConfigured) {
      this.errorMessage = 'Set Firebase Web App configuration in frontend/src/environments/environment.ts before using phone sign-in.';
    }
  }

  ngOnDestroy(): void {
    this.stopCooldown();
    this.firebase.clearRecaptcha();
  }

  setMode(register: boolean): void {
    this.firebase.clearRecaptcha();
    this.registerMode = register;
    this.errorMessage = '';
    this.infoMessage = '';
    this.confirmation = null;
    this.otp = '';
  }

  async sendOtp(): Promise<void> {
    this.errorMessage = '';
    this.infoMessage = '';
    if (this.busy || this.cooldownSeconds > 0) return;
    if (this.registerMode && this.fullName.trim().length < 2) {
      this.errorMessage = 'Enter your full name.';
      return;
    }

    try {
      const e164 = this.firebase.normalizePhone(this.phoneNumber);
      this.busy = true;
      this.confirmation = await this.firebase.sendOtp(e164);
      this.phoneNumber = e164;
      this.verificationAttempts = 0;
      this.otp = '';
      this.infoMessage = `Verification code sent to ${e164}.`;
      this.startCooldown();
    } catch (error) {
      this.errorMessage = this.describeError(error);
      this.firebase.clearRecaptcha();
    } finally {
      this.busy = false;
    }
  }

  async verifyOtp(): Promise<void> {
    if (!this.confirmation || this.busy) return;
    if (!/^\d{6}$/.test(this.otp.trim())) {
      this.errorMessage = 'Enter the 6-digit verification code.';
      return;
    }
    if (this.verificationAttempts >= 5) {
      this.errorMessage = 'Too many verification attempts. Request a new code after the cooldown.';
      return;
    }

    this.busy = true;
    this.errorMessage = '';
    try {
      await this.confirmation.confirm(this.otp.trim());
      if (this.registerMode) {
        await new Promise<void>((resolve, reject) => {
          this.accounts.register(this.fullName, this.firebase.normalizePhone(this.phoneNumber))
            .subscribe({ next: () => resolve(), error: reject });
        });
      } else {
        await new Promise<void>((resolve, reject) => {
          this.accounts.getProfile().subscribe({ next: () => resolve(), error: reject });
        });
      }
      await this.router.navigateByUrl(this.returnUrl);
    } catch (error) {
      this.verificationAttempts += 1;
      if (error instanceof HttpErrorResponse && error.status === 404 && !this.registerMode) {
        this.errorMessage = 'No account exists for this phone number. Switch to Register to create one.';
      } else {
        this.errorMessage = this.describeError(error);
      }
      if (this.registerMode && error instanceof HttpErrorResponse) {
        await this.firebase.logout();
        this.confirmation = null;
      }
    } finally {
      this.busy = false;
    }
  }

  private startCooldown(): void {
    this.stopCooldown();
    this.cooldownSeconds = 30;
    this.cooldownTimer = setInterval(() => {
      this.cooldownSeconds = Math.max(0, this.cooldownSeconds - 1);
      if (this.cooldownSeconds === 0) this.stopCooldown();
    }, 1000);
  }

  private stopCooldown(): void {
    if (this.cooldownTimer) clearInterval(this.cooldownTimer);
    this.cooldownTimer = null;
  }

  private describeError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      return error.error?.message || 'Account request failed. Please try again.';
    }
    if (error instanceof Error) return error.message;
    return 'Could not verify the phone number. Please try again.';
  }
}
