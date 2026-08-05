@echo off
set "NODE_HOME=%USERPROFILE%\Documents\node"
set "PATH=%NODE_HOME%;%NODE_HOME%\node_modules\npm\bin;%PATH%"

cd /d "%~dp0"

echo Using local Node:
node -v

echo Using local npm:
call npm -v

echo.
echo Current folder:
cd

echo.
echo Installing dependencies if node_modules is missing...
if not exist node_modules (
    call npm install
    if errorlevel 1 (
        echo.
        echo npm install failed.
        pause
        exit /b 1
    )
)

echo.
echo Starting Vite dev server...
call npm run dev

echo.
echo Dev server stopped or failed.
pause
