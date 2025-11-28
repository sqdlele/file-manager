# Скрипт для сборки frontend
Write-Host "Сборка React приложения..." -ForegroundColor Green
Set-Location frontend
npm install
npm run build
Set-Location ..
Write-Host "Сборка завершена! Теперь можно запустить: dotnet run" -ForegroundColor Green

