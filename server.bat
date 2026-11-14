@echo off
echo ============================================
echo   DMS Dev - Starting Frontend + Backend   
echo ============================================

start "DMS Backend" cmd /k "cd /d %~dp0backend && .venv\Scripts\activate && uvicorn app.main:app --reload --host 0.0.0.0 --port 8001"

timeout /t 3 /nobreak >nul

start "DMS Frontend" cmd /k "cd /d %~dp0web && npm run dev"

echo.
echo [OK] Backend:  http://localhost:8001
echo [OK] Frontend: http://localhost:3001
