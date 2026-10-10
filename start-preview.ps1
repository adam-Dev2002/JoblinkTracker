$ErrorActionPreference = 'Stop'
$runtime = Join-Path $PSScriptRoot '.local-tools\node-v24.21.0-win-x64'
$pnpm = Join-Path $PSScriptRoot '.local-tools\pnpm\node_modules\.bin\pnpm.cmd'
$env:PATH = "$runtime;$(Split-Path $pnpm);$env:PATH"
$cloudPreview = Join-Path $PSScriptRoot 'tabler-dev\tabler-dev\preview'
$cloudEnvironment = Join-Path $cloudPreview '.env'
if ((Test-Path -LiteralPath $cloudEnvironment) -and ((Get-Content -LiteralPath $cloudEnvironment) -match '^JOBLINK_BACKEND=["'']?supabase')) {
    Set-Location $cloudPreview
    & (Join-Path $runtime 'node.exe') --env-file=.env node_modules/astro/bin/astro.mjs dev --host 127.0.0.1
    exit $LASTEXITCODE
}
$auth = Join-Path $PSScriptRoot 'auth'
$listener = Get-NetTCPConnection -State Listen -LocalPort 8081 -ErrorAction SilentlyContinue
if (-not $listener) {
    Start-Process -FilePath 'C:\xampp\php\php.exe' -WorkingDirectory $auth -ArgumentList '-S 127.0.0.1:8081 router.php' -WindowStyle Hidden -RedirectStandardOutput (Join-Path $auth 'runtime-server.log') -RedirectStandardError (Join-Path $auth 'runtime-error.log')
}
$feedListener = Get-NetTCPConnection -State Listen -LocalPort 8082 -ErrorAction SilentlyContinue
if (-not $feedListener) {
    Start-Process -FilePath 'C:\xampp\php\php.exe' -WorkingDirectory $auth -ArgumentList '-S 127.0.0.1:8082 router.php' -WindowStyle Hidden -RedirectStandardOutput (Join-Path $auth 'feed-server.log') -RedirectStandardError (Join-Path $auth 'feed-error.log')
}
$assistantListener = Get-NetTCPConnection -State Listen -LocalPort 8083 -ErrorAction SilentlyContinue
if (-not $assistantListener) {
 Start-Process -FilePath 'C:\xampp\php\php.exe' -WorkingDirectory $auth -ArgumentList '-S 127.0.0.1:8083 router.php' -WindowStyle Hidden -RedirectStandardOutput (Join-Path $auth 'assistant-server.log') -RedirectStandardError (Join-Path $auth 'assistant-error.log')
}
Set-Location (Join-Path $PSScriptRoot 'tabler-dev\tabler-dev')
& $pnpm --dir preview exec astro dev --host 127.0.0.1

