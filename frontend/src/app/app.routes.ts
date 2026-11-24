import { Routes } from '@angular/router';
import { Home } from './pages/home/home';
import { Upload } from './pages/upload/upload';
import { AuthPage } from './pages/auth/auth';
import { Dashboard } from './pages/dashboard/dashboard';
import { authGuard } from './guards/auth.guard';
import { AdminPage } from './pages/admin/admin';

export const routes: Routes = [

  {
    path: '',
    component: Home
  },

  {
    path: 'upload',
    component: Upload,
    canActivate: [authGuard]
  },

  {
    path: 'auth',
    component: AuthPage
  },

  {
    path: 'dashboard',
    component: Dashboard,
    canActivate: [authGuard]
  },

  {
    path: 'admin',
    component: AdminPage,
    canActivate: [authGuard]
  },

  {
    path: '**',
    redirectTo: ''
  }

];