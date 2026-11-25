@echo off
setlocal
cd /d "%~dp0"
title eTax Manager HAK Group - dong cua so nay de tat ung dung
if not exist "runtime\node.exe" (
  node -v >nul 2>&1
  if errorlevel 1 call :getnode
)
set "NODE=runtime\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" -v >nul 2>&1
if errorlevel 1 (
  echo.
  echo Khong tim thay Node.js va khong tai duoc ^(may khong co Internet?^).
  echo.
  echo Cach 1: noi mang roi bam dup lai file nay ^(chi tai 1 lan, khoang 30 MB^).
  echo Cach 2: cai Node.js ban LTS tai https://nodejs.org ^(bam nut LTS, mo file .msi, Next den het^) roi bam dup lai file nay.
  echo Cach 3: chep file node.exe vao thu muc "runtime" ben canh file nay.
  echo.
  pause
  exit /b 1
)
chcp 65001 >nul
"%NODE%" server\server.mjs --open
echo.
echo Ung dung da dung. Bam phim bat ky de dong cua so.
pause >nul
exit /b 0

:getnode
echo.
echo Lan dau chay tren may nay: dang tai Node.js ^(khoang 30 MB, chi tai 1 lan^)...
echo Vui long doi, khong dong cua so.
if not exist runtime mkdir runtime
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; try { Invoke-WebRequest -UseBasicParsing 'https://nodejs.org/dist/latest-v22.x/win-x64/node.exe' -OutFile 'runtime\node.exe.tmp'; Move-Item -Force 'runtime\node.exe.tmp' 'runtime\node.exe' } catch { exit 1 }"
if errorlevel 1 del "runtime\node.exe.tmp" 2>nul
exit /b 0
