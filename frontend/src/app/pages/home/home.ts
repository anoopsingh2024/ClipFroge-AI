
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';

interface GeneratedClip {
  filename: string;
  duration: number;
  start: number;
  end: number;
  score?: number;
}

interface ProcessingResult {
  success: boolean;
  message: string;
  totalClips: number;
  duration: number;
  language: string;
  clips: GeneratedClip[];
  jobId: string;
  downloadUrl: string;
  expiresInMinutes: number;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink, CommonModule],
  templateUrl: './home.html',
  styleUrl: './home.scss'
})
export class Home {

  private readonly API_URL = 'http://localhost:5000/api/videos';

  isProcessing = false;
  isDownloading = false;

  result: ProcessingResult | null = null;

  constructor(private http: HttpClient) {}

  processVideoUrl(url: string): void {

    const videoUrl = url.trim();

    if (!videoUrl) {
      alert('Please paste a YouTube or Facebook video URL.');
      return;
    }

    let parsedUrl: URL;

    try {
      parsedUrl = new URL(videoUrl);
    } catch {
      alert('Please enter a valid video URL.');
      return;
    }

    const hostname = parsedUrl.hostname.toLowerCase();

    const isYouTube =
      hostname === 'youtube.com' ||
      hostname.endsWith('.youtube.com') ||
      hostname === 'youtu.be';

    const isFacebook =
      hostname === 'facebook.com' ||
      hostname.endsWith('.facebook.com') ||
      hostname === 'fb.watch' ||
      hostname.endsWith('.fb.watch');

    if (!isYouTube && !isFacebook) {
      alert('Only YouTube and Facebook URLs are supported.');
      return;
    }

    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    this.result = null;

    this.http.post<ProcessingResult>(
      `${this.API_URL}/process-url`,
      { url: videoUrl }
    ).subscribe({

      next: (response) => {

        this.isProcessing = false;

        if (!response?.success || !response.jobId) {
          alert(response?.message || 'Video processing failed.');
          return;
        }

        this.result = response;

        console.log('ClipForge AI Result:', response);

      },

      error: (error) => {

        this.isProcessing = false;

        console.error('Video URL processing error:', error);

        alert(
          error.error?.message ||
          error.error?.error ||
          'Unable to process this video. Please try another supported public URL.'
        );
      }
    });
  }

  downloadAllClips(): void {

    if (!this.result?.jobId || this.isDownloading) {
      return;
    }

    this.isDownloading = true;

    const downloadUrl =
      `${this.API_URL}/download/${encodeURIComponent(this.result.jobId)}`;

    this.http.get(downloadUrl, {
      responseType: 'blob'
    }).subscribe({

      next: (blob: Blob) => {

        this.isDownloading = false;

        if (!blob || blob.size === 0) {
          alert('Downloaded ZIP is empty. Please process your video again.');
          return;
        }

        const objectUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = objectUrl;
        link.download = 'ClipForge-AI-Clips.zip';

        document.body.appendChild(link);
        link.click();
        link.remove();

        // Allow the browser time to start the download.
        setTimeout(() => {
          window.URL.revokeObjectURL(objectUrl);
        }, 60000);

        alert('Your clips ZIP download has started!');

        // The backend handles temporary file cleanup.
        this.result = null;
      },

      error: (error) => {

        this.isDownloading = false;

        console.error('Download error:', error);

        alert(
          error.error?.message ||
          'Download failed or expired. Please generate your clips again.'
        );
      }
    });
  }
}
