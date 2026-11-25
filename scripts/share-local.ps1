$ErrorActionPreference = 'Stop'

if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
  throw 'cloudflared is not installed. Install it with: winget install --id Cloudflare.cloudflared'
}

foreach ($service in @(
  @{ Name = 'ClipForge backend'; Url = 'http://localhost:5000/api/health' },
  @{ Name = 'ClipForge frontend'; Url = 'http://localhost:4200/' }
)) {
  try {
    Invoke-WebRequest -Uri $service.Url -UseBasicParsing -TimeoutSec 8 | Out-Null
  } catch {
    throw "$($service.Name) is not responding at $($service.Url). Start both apps before sharing."
  }
}

Write-Host 'Starting a temporary public URL. Keep this window and both app servers running.'
Write-Host 'Share the https://*.trycloudflare.com URL printed below.'
Write-Warning 'Anyone with the URL can use this app while the tunnel is running.'

& cloudflared tunnel --url http://localhost:4200 --http-host-header localhost:4200
if ($LASTEXITCODE -ne 0) {
  throw "cloudflared exited with code $LASTEXITCODE."
}
