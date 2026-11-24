import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { FirebaseAuthService } from '../services/firebase-auth';

export const authGuard: CanActivateFn = async (_route, state) => {
  const firebase = inject(FirebaseAuthService);
  const router = inject(Router);
  if (!firebase.isConfigured) {
    return router.createUrlTree(['/auth'], { queryParams: { returnUrl: state.url } });
  }
  try {
    const user = await firstValueFrom(firebase.userState);
    return user
      ? true
      : router.createUrlTree(['/auth'], { queryParams: { returnUrl: state.url } });
  } catch {
    return router.createUrlTree(['/auth'], { queryParams: { returnUrl: state.url } });
  }
};
