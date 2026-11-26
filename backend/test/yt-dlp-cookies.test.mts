import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getYouTubeCookieArgs } from '../src/utils/yt-dlp-cookies';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories.splice(0).map(directory =>
      fs.rm(directory, { recursive: true, force: true })
    )
  );
});

describe('YouTube yt-dlp cookie arguments', () => {
  it('leaves cookies optional when browser cookies are disabled', async () => {
    vi.stubEnv('CLIPFORGE_YTDLP_COOKIES', '');
    vi.stubEnv('CLIPFORGE_YTDLP_BROWSER', 'none');

    await expect(getYouTubeCookieArgs()).resolves.toEqual([]);
  });

  it('passes a readable cookie file as a separate yt-dlp argument', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'clipforge-cookies-'));
    temporaryDirectories.push(directory);
    const cookiesPath = path.join(directory, 'cookies.txt');
    await fs.writeFile(cookiesPath, '# Netscape HTTP Cookie File\n');
    vi.stubEnv('CLIPFORGE_YTDLP_COOKIES', cookiesPath);

    await expect(getYouTubeCookieArgs()).resolves.toEqual([
      '--cookies',
      path.resolve(cookiesPath)
    ]);
  });

  it('rejects a configured cookie file that is missing', async () => {
    vi.stubEnv(
      'CLIPFORGE_YTDLP_COOKIES',
      path.join(os.tmpdir(), `clipforge-missing-${randomUUID()}.txt`)
    );

    await expect(getYouTubeCookieArgs()).rejects.toThrow(
      'The configured CLIPFORGE_YTDLP_COOKIES file is missing, unreadable, or not a regular file.'
    );
  });

  it('rejects a configured cookie path that points to a directory', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'clipforge-cookies-'));
    temporaryDirectories.push(directory);
    vi.stubEnv('CLIPFORGE_YTDLP_COOKIES', directory);

    await expect(getYouTubeCookieArgs()).rejects.toThrow(
      'The configured CLIPFORGE_YTDLP_COOKIES file is missing, unreadable, or not a regular file.'
    );
  });
});
