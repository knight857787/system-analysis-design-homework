@echo off
chcp 65001 >nul
cd /d "%~dp0系统源代码"
where python >nul 2>nul
if errorlevel 1 (
  echo Python 3.10 or newer is required.
  pause
  exit /b 1
)
echo Starting Store Assistant...
echo Open http://127.0.0.1:19870 in your browser.
python run.py
pause
