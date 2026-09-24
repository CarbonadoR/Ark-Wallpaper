@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Wallpaper.ps1"
if errorlevel 1 pause
