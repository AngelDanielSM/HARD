@echo off
setlocal
set "NODE_BIN=C:\Users\SRT\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
set "PNPM_BIN=C:\Users\SRT\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback"
if not exist "%NODE_BIN%\node.exe" (
  echo No encuentro Node.js en "%NODE_BIN%".
  echo Instala Node.js LTS desde https://nodejs.org/ y vuelve a intentarlo.
  pause
  exit /b 1
)
if not exist "%PNPM_BIN%\pnpm.cmd" (
  echo No encuentro pnpm en "%PNPM_BIN%".
  echo Instala pnpm con Corepack y vuelve a intentarlo.
  pause
  exit /b 1
)
set "PATH=%NODE_BIN%;%PNPM_BIN%;%PATH%"
cd /d "%~dp0"
call "%PNPM_BIN%\pnpm.cmd" dev
endlocal
