$NodeRoot = "C:\node"
$NvmRoot = "C:\nvm"

if (-not (Test-Path (Join-Path $NodeRoot "node.exe"))) {
  throw "Local node.exe not found at C:\node\node.exe"
}

if (-not (Test-Path (Join-Path $NodeRoot "npm.cmd"))) {
  throw "Local npm.cmd not found at C:\node\npm.cmd"
}

$prefix = "$NodeRoot;$NvmRoot"
if (-not $env:Path.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  $env:Path = "$prefix;$env:Path"
}

Remove-Item Alias:npm -ErrorAction SilentlyContinue
Remove-Item Alias:node -ErrorAction SilentlyContinue
Set-Alias -Name npm -Value (Join-Path $NodeRoot "npm.cmd")
Set-Alias -Name node -Value (Join-Path $NodeRoot "node.exe")

Write-Host "Using local Node tooling:" -ForegroundColor Green
Write-Host "  node: $(node -v)"
Write-Host "  npm:  $(npm -v)"
Write-Host "  path: $NodeRoot, $NvmRoot"
