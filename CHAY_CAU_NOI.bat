@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Can cai Node.js 20.19+ truoc. & pause & exit /b 1)
echo Dang chay cau noi nap code CT Robot EDU. Giu cua so nay mo.
node server\bridge.js
pause
