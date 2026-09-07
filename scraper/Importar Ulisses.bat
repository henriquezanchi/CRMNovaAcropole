@echo off
cd /d "%~dp0"
echo ================================================
echo  Importar Ulisses - login manual, todas as filiais
echo ================================================
echo.
echo Uma janela do Chromium vai abrir por filial. Faca o login
echo manualmente em cada uma (resolva o desafio do Cloudflare se
echo aparecer). O script continua sozinho depois disso.
echo.
call npm run ulisses-local
echo.
echo ================================================
echo  Concluido. Confira o resumo acima.
echo ================================================
pause
