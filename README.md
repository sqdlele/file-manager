# Менеджер фоновых задач

## Технологии
 **Backend**: ASP.NET 9.0 с SignalR (Windows Runtime для системных уведомлений)
 **Frontend**: React 19 + Vite

### Зависимости проекта:

**Backend:**
- `Microsoft.AspNetCore.OpenApi` (9.0.0)
- `Microsoft.AspNetCore.SignalR` (1.2.0)
- `RabbitMQ.Client` (6.8.1)

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

## Особенности

### Системные уведомления Windows
При срабатывании будильника уведомления показываются:
- В браузере (через Web Notifications API)
- На рабочем столе Windows (через Windows Toast Notifications)
- RabbitMQ для отправки и получения сообщений через очереди.


#### Настройка rabbitmq

1. запустить rabbitmq сервер 
2. настроить параметры подключения в `appsettings.json`:

```json
{
  "RabbitMQ": {
    "HostName": "localhost",
    "Port": "5672",
    "UserName": "guest",
    "Password": "guest",
    "VirtualHost": "/",
    "ConsumerQueueName": "test_queue"
  }
}
```

#### Отправка сообщений в очередь

Используйте API endpoint для отправки сообщений:


#### Получение сообщений из очереди

Фоновый сервис `RabbitMqConsumerService` автоматически запускается при старте приложения и слушает очередь, указанную в `RabbitMQ:ConsumerQueueName` (по умолчанию `test_queue`).

Все полученные сообщения логируются в консоль. Для обработки сообщений можно модифицировать метод `ProcessMessageAsync` в `RabbitMqConsumerService.cs`.

**Важно:** Если RabbitMQ сервер не запущен, приложение все равно запустится, но:
- Фоновый сервис будет пытаться переподключиться каждые 5 секунд
- Отправка сообщений через API вернет ошибку
- В логах будут сообщения об ошибках подключения

#### Масштабирование

Для обработки сообщений из разных очередей можно:
1. Создать несколько экземпляров `RabbitMqConsumerService` с разными именами очередей
2. Настроить каждый фоновый процесс для работы с определенной очередью
3. Использовать разные очереди для разных типов задач







