@echo off
setlocal enabledelayedexpansion

echo =========================================================
echo  INICIANDO AMBIENTE LOCAL FRONTAL E API - LEXCRM
echo =========================================================

:: Mata processos anteriores para evitar conflitos de porta
taskkill /F /IM node.exe /T 2>nul

echo [1/3] Limpando cache e preparando...
echo.

:: Tenta iniciar a API em uma nova janela
echo [2/3] Iniciando API (Porta 3005) em segundo plano...
start "LexCRM - API" cmd /c "npm run start:dev --workspace=apps/api"

:: Espera um pouco para a API subir antes do Web
timeout /t 5 /nobreak >nul

:: Inicia o Web no terminal atual
echo [3/3] Iniciando Painel Web (Porta 3000)...
echo.
echo =========================================================
echo  Painel CRM: http://localhost:3000
echo  API Back: http://localhost:3005
echo =========================================================
echo.

npm run dev --workspace=apps/web
