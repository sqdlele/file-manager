# Менеджер фоновых задач

## Технологии
 **Backend**: ASP.NET 9.0 с SignalR (Windows Runtime для системных уведомлений)
 **Frontend**: React 19 + Vite

### Зависимости проекта:

**Backend:**
- `Microsoft.AspNetCore.OpenApi` (9.0.0)
- `Microsoft.AspNetCore.SignalR` (1.2.0)

**Frontend:**
- `react` (^19.2.0)
- `react-dom` (^19.2.0)
- `@microsoft/signalr` (^8.0.0)
- `vite` (^7.2.4)

## Запуск приложения
### Режим разработки 
для автоматических изменений

1. Запустить Backend:
cd backend
dotnet restore
dotnet run

2. В другом терминале запустить Frontend (Vite dev server):

cd backend/frontend
npm install
npm run dev

Открыть: http://localhost:5173

### Режим продакшена (все на одном хосте)
1. Собрать frontend:

cd backend/frontend
npm install
npm run build

2. Запустить backend (он будет обслуживать и frontend):

cd backend
dotnet restore
dotnet run

Открыть: http://localhost:5270

### Системные уведомления Windows
- В браузере (через Web Notifications API)
- На рабочем столе Windows (через Windows Toast Notifications)







