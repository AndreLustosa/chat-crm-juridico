@echo off
echo ==============================================
echo  INICIANDO AMBIENTE LOCAL FRONTAL - LEXCRM
echo ==============================================

echo [1/2] Instalando dependencias do painel Web...
call npm install

echo [2/2] Iniciando o React conectado direto com a VPS Principal...
echo.
echo =========================================================
echo  Painel CRM (React Local) disponivel em: http://localhost:3000
echo  A API esta conectada externamente em: 69.62.93.186
echo =========================================================
call npm run dev --workspace=apps/web
