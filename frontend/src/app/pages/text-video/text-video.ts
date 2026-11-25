import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';

interface TextVideoResult {
  success: boolean;
  message: string;
  filename: string;
  duration: number;
  style: string;
  language: string;
  scenes: string[];
  voice: string;
  music: string;
  url: string;
}

@Component({
  selector: 'app-text-video',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './text-video.html',
  styleUrl: './text-video.scss'
})
export class TextVideo {
  text = '';
  style: 'cartoon' | 'documentary' = 'cartoon';
  language: 'en' | 'hi' = 'en';
  isGenerating = false;
  errorMessage = '';
  result: TextVideoResult | null = null;
  readonly maxCharacters = 20_000;

  constructor(private http: HttpClient) {}

  async onTextFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    if (!/\.(txt|md)$/i.test(file.name)) {
      this.errorMessage = 'Please choose a TXT or Markdown (.md) file.';
      return;
    }

    if (file.size > this.maxCharacters * 4) {
      this.errorMessage = 'Text file is too large. Keep it under 20,000 characters.';
      return;
    }

    try {
      this.text = (await file.text()).slice(0, this.maxCharacters);
      this.errorMessage = '';
      this.result = null;
    } catch (error) {
      this.errorMessage = error instanceof Error
        ? `Could not read the text file: ${error.message}`
        : 'Could not read the selected text file.';
    }
  }

  generate(): void {
    const text = this.text.trim();
    if (!text || this.isGenerating) return;
    if (text.length > this.maxCharacters) {
      this.errorMessage = `Text must be ${this.maxCharacters.toLocaleString()} characters or less.`;
      return;
    }

    this.isGenerating = true;
    this.errorMessage = '';
    this.result = null;
    this.http.post<TextVideoResult>(`${environment.apiUrl}/text-video/generate`, {
      text,
      style: this.style,
      language: this.language
    }).subscribe({
      next: result => {
        this.isGenerating = false;
        if (!result?.success || !result.url) {
          this.errorMessage = result?.message || 'Video generation failed.';
          return;
        }
        this.result = result;
      },
      error: error => {
        this.isGenerating = false;
        this.errorMessage =
          error?.error?.error ||
          error?.error?.message ||
          'Could not generate the video. Check the backend and offline voice setup.';
      }
    });
  }

  resolveVideoUrl(url: string): string {
    if (/^https?:\/\//i.test(url)) return url;
    return `${environment.apiUrl.replace(/\/api$/, '')}/${url.replace(/^\/+/, '')}`;
  }
}
