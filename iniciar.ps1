$ErrorActionPreference = 'Stop'

# Añade al PATH el Node.js y pnpm que ya están disponibles en este equipo.
$nodeBin = 'C:\Users\SRT\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
$pnpmBin = 'C:\Users\SRT\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback'

if (-not (Test-Path (Join-Path $nodeBin 'node.exe'))) {
    throw "No encuentro Node.js en $nodeBin. Instala Node.js LTS desde https://nodejs.org/ y vuelve a intentarlo."
}
if (-not (Test-Path (Join-Path $pnpmBin 'pnpm.cmd'))) {
    throw "No encuentro pnpm en $pnpmBin. Instala pnpm con Corepack y vuelve a intentarlo."
}

$env:PATH = "$nodeBin;$pnpmBin;$env:PATH"
Set-Location $PSScriptRoot
& (Join-Path $pnpmBin 'pnpm.cmd') dev
