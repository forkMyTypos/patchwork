@echo off
rem Double-click to open the Patchwork admin. Close this window to stop it.
cd /d "%~dp0"
where py >nul 2>nul && (py admin.py %*) || (python admin.py %*)
if errorlevel 1 pause
