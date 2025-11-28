#!/bin/bash
# Скрипт для сборки frontend
echo "Сборка React приложения..."
cd frontend
npm install
npm run build
cd ..
echo "Сборка завершена! Теперь можно запустить: dotnet run"

