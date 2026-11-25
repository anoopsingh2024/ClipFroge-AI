import { Routes } from '@angular/router';
import { Home } from './pages/home/home';
import { Upload } from './pages/upload/upload';
import { TextVideo } from './pages/text-video/text-video';

export const routes: Routes = [

  {
    path: '',
    component: Home
  },

  {
    path: 'upload',
    component: Upload
  },
  {
    path: 'text-video',
    component: TextVideo
  },

  {
    path: '**',
    redirectTo: ''
  }

];