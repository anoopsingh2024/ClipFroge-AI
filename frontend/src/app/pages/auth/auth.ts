import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
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
  private destroyed = false;
  private returnUrl = '/dashboard';

  constructor(
    readonly firebase: FirebaseAuthService,
    private accounts: AccountService,
    private router: Router,
    private route: ActivatedRoute,
    private changeDetector: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.registerMode = this.route.snapshot.queryParamMap.get('mode') === 'register';
    this.returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/dashboard';
  }

  ngOnDestroy(): void {
    this.destroyed = true;
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
    this.refreshView();
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
      this.refreshView();
      this.confirmation = await this.firebase.sendOtp(e164);
      this.phoneNumber = e164;
      this.verificationAttempts = 0;
      this.otp = '';
      this.infoMessage = `Verification code sent to ${e164}.`;
      this.startCooldown();
    } catch (error) {
      this.logFirebaseError(error);
      this.errorMessage = this.describeError(error);
      this.firebase.clearRecaptcha();
    } finally {
      this.busy = false;
      this.refreshView();
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
    this.refreshView();
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
      this.refreshView();
    }
  }

  private startCooldown(): void {
    this.stopCooldown();
    this.cooldownSeconds = 30;
    this.cooldownTimer = setInterval(() => {
      this.cooldownSeconds = Math.max(0, this.cooldownSeconds - 1);
      this.refreshView();
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
    if (error instanceof Error) {
      const code = (error as Error & { code?: string }).code;
      switch (code) {
        case 'auth/operation-not-allowed':
          return `Firebase project "${this.firebase.projectId}" is rejecting phone sign-in. Since Phone is enabled, verify that environment.ts apiKey belongs to this same project, the Identity Toolkit API is enabled and allowed for that API key, then stop and restart ng serve.`;
        case 'auth/unauthorized-domain':
          return 'Add localhost to Firebase Authentication → Settings → Authorized domains.';
        case 'auth/invalid-phone-number':
          return 'Enter a valid Indian mobile number with 10 digits.';
        case 'auth/invalid-app-credential':
        case 'auth/missing-app-credential':
          return 'Firebase rejected the app verification. Check Phone Authentication, add localhost to Authorized domains, and make sure the Firebase API key allows Identity Toolkit API.';
        case 'auth/invalid-api-key':
        case 'auth/api-key-not-valid':
          return 'Firebase API key is invalid or restricted. Verify the Web App config and allow Identity Toolkit API for this key.';
        case 'auth/app-not-authorized':
          return 'This web app or domain is not authorized in Firebase. Check the Firebase project and add localhost to Authorized domains.';
        case 'auth/quota-exceeded':
          return 'Firebase SMS quota is exceeded. Use a configured Firebase test phone number or check the project SMS limits.';
        case 'auth/too-many-requests':
          return 'Firebase temporarily blocked SMS requests. Wait and try again, or use a Firebase test phone number.';
        case 'auth/network-request-failed':
          return 'Firebase could not be reached. Check your internet connection and allow Google reCAPTCHA and Firebase Auth requests in the browser/network.';
        case 'auth/captcha-check-failed':
        case 'auth/missing-recaptcha-token':
          return 'Phone verification could not complete reCAPTCHA. Allow Google reCAPTCHA in your browser and try again.';
      }
      return code
        ? `Firebase error (${code}): ${error.message}`
        : error.message;
    }
    return 'Could not verify the phone number. Please try again.';
  }

  private refreshView(): void {
    if (!this.destroyed) this.changeDetector.detectChanges();
  }

  private logFirebaseError(error: unknown): void {
    if (error instanceof Error) {
      const code = (error as Error & { code?: string }).code || 'unknown';
      console.error('[AUTH] Phone verification failed:', code, error.message);
    } else {
      console.error('[AUTH] Phone verification failed with an unknown error.');
    }
  }
}
