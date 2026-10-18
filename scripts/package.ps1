$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$destination = Join-Path $root 'ScamTraceAI.zip'
$temporary = Join-Path $root 'ScamTraceAI.build.zip'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$include = @('backend','src','streaming','agent_service','scripts','tests','reports')
$rootFiles = @('.env.example','.gitignore','ARCHITECTURE.mmd','DEMO.md','README.md','docker-compose.advanced.yml','index.html','package-lock.json','package.json','requirements.txt','requirements-advanced.txt','start.ps1','tsconfig.json','vite.config.ts')
if (Test-Path $temporary) { Remove-Item -LiteralPath $temporary -Force }
$archive = [IO.Compression.ZipFile]::Open($temporary, [IO.Compression.ZipArchiveMode]::Create)
try {
  $files = @()
  foreach ($directory in $include) {
    $absolute = Join-Path $root $directory
    if (Test-Path $absolute) { $files += Get-ChildItem -LiteralPath $absolute -File -Recurse }
  }
  foreach ($file in $rootFiles) {
    $absolute = Join-Path $root $file
    if (Test-Path $absolute -PathType Leaf) { $files += Get-Item -LiteralPath $absolute }
  }
  foreach ($file in $files) {
    $relative = $file.FullName.Substring($root.Length + 1).Replace('\','/')
    if ($relative -match '(^|/)(__pycache__|\.pytest_cache|node_modules|\.venv|dist|\.run|logs|data)(/|$)' -or $relative.EndsWith('.pyc')) { continue }
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $relative, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $archive.Dispose() }
Move-Item -LiteralPath $temporary -Destination $destination -Force
Write-Host "Created $destination"
