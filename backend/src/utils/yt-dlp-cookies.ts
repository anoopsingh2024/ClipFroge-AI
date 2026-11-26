import fs from 'fs';
import path from 'path';

export async function getYouTubeCookieArgs(): Promise<string[]> {
  const cookiesFile = process.env.CLIPFORGE_YTDLP_COOKIES?.trim();

  if (cookiesFile) {
    const resolvedPath = path.resolve(cookiesFile);

    try {
      const stat = await fs.promises.stat(resolvedPath);
      if (!stat.isFile()) {
        throw new Error('Configured cookie path is not a file.');
      }
      await fs.promises.access(resolvedPath, fs.constants.R_OK);
    } catch {
      throw new Error(
        'The configured CLIPFORGE_YTDLP_COOKIES file is missing, unreadable, or not a regular file. Check its path and backend read permissions.'
      );
    }

    return ['--cookies', resolvedPath];
  }

  const browser = (process.env.CLIPFORGE_YTDLP_BROWSER || 'none')
    .trim()
    .toLowerCase();

  if (browser === 'none' || browser === 'off' || browser === '') {
    return [];
  }

  const supportedBrowsers = new Set([
    'firefox',
    'chrome',
    'edge',
    'brave',
    'opera',
    'vivaldi'
  ]);

  if (!supportedBrowsers.has(browser)) {
    throw new Error(
      'Unsupported cookie browser. Use firefox, chrome, edge, brave, opera, vivaldi, or none.'
    );
  }

  return ['--cookies-from-browser', browser];
}
