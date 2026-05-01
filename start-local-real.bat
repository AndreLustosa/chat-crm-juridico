@echo off
setlocal

echo =========================================================
echo  INICIANDO FRONT LOCAL COM API REAL - LEXCRM
echo =========================================================
echo.
echo Front local: http://localhost:3000
echo API real:    https://andrelustosaadvogados.com.br/api
echo Socket real: wss://andrelustosaadvogados.com.br
echo.

cd /d "%~dp0"
set "NEXT_PUBLIC_API_URL=/api"
set "INTERNAL_API_URL=https://andrelustosaadvogados.com.br/api"
set "NEXT_PUBLIC_WS_URL=wss://andrelustosaadvogados.com.br"
npm run dev --workspace=apps/web
