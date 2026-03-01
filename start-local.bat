@echo off
setlocal enabledelayedexpansion

echo =========================================================
echo  INICIANDO AMBIENTE LOCAL FRONTAL E API - LEXCRM
echo =========================================================

:: Mata processos node anteriores
echo [0/3] Limpando processos antigos...
taskkill /F /IM node.exe /T 2>nul
timeout /t 2 /nobreak >nul

echo [1/3] Garantindo dependencias e Build...
:: Forçar geração do prisma e build da API
cmd /c "npm install"
cmd /c "npm run db:generate --workspace=@crm/shared"
cmd /c "npm run build --workspace=apps/api"

echo.

:: Inicia a API
echo [2/3] Iniciando API em nova janela...
start "LexCRM - API" cmd /c "title LexCRM - API && echo Aguardando inicializacao... && node apps/api/dist/main.js || pause"

:: Espera a API subir
echo Aguardando 5 segundos para a API inicializar...
timeout /t 5 /nobreak >nul

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
