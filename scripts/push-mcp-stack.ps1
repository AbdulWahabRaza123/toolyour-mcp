# Push MCP stack commits (AbdulWahabRaza123 org — not assessmentproject0505-tech gh login).
# Usage from repo root:
#   $env:GITHUB_TOKEN = "ghp_..."   # PAT with repo scope
#   .\scripts\push-mcp-stack.ps1

$ErrorActionPreference = "Stop"
$mcpRoot = Split-Path -Parent $PSScriptRoot
$root = Split-Path -Parent $mcpRoot

function Push-Repo($dir, $branch) {
  Write-Host "`n==> $dir ($branch)" -ForegroundColor Cyan
  Push-Location (Join-Path $root $dir)
  git status -sb
  if ($env:GITHUB_TOKEN) {
    $remote = git remote get-url origin
    if ($remote -match "github\.com") {
      $url = $remote -replace "https://", "https://$($env:GITHUB_TOKEN)@"
      git push $url $branch
    } else {
      git push origin $branch
    }
  } else {
    git push origin $branch
  }
  Pop-Location
}

Push-Repo "toolyour-mcp" "main"
Push-Repo "toolyour-apis" "master"
Push-Repo "toolbox" "master"
Push-Repo "toolyour-docs/customer" "main"

Write-Host "`nDeploy order: toolyour-apis -> toolyour-mcp -> toolbox -> Cloudflare Pages (customer docs)." -ForegroundColor Green
