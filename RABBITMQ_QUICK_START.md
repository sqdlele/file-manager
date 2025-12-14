# RabbitMQ - Быстрый старт

## Подключение к вашему RabbitMQ серверу

**Параметры:**
- Host: `localhost`
- Port: `5672`
- Username: `guest`
- Password: `guest`
- Management UI: http://localhost:15672

---

## Отправка сообщений

### .NET / C#
```csharp
using RabbitMQ.Client;
using System.Text;

var factory = new ConnectionFactory { HostName = "localhost" };
using var connection = factory.CreateConnection();
using var channel = connection.CreateModel();

channel.QueueDeclare("my_queue", durable: true, exclusive: false, autoDelete: false, null);
channel.BasicPublish("", "my_queue", null, Encoding.UTF8.GetBytes("Привет!"));
```

### Node.js
```javascript
const amqp = require('amqplib');

const connection = await amqp.connect('amqp://localhost');
const channel = await connection.createChannel();
await channel.assertQueue('my_queue', { durable: true });
channel.sendToQueue('my_queue', Buffer.from('Привет!'));
```

---

## Получение сообщений

### .NET / C#
```csharp
var consumer = new EventingBasicConsumer(channel);
consumer.Received += (model, ea) => {
    var body = ea.Body.ToArray();
    var message = Encoding.UTF8.GetString(body);
    Console.WriteLine($"Получено: {message}");
    channel.BasicAck(ea.DeliveryTag, false);
};
channel.BasicConsume("my_queue", false, consumer);
```

### Node.js
```javascript
channel.consume('my_queue', (msg) => {
    console.log('Получено:', msg.content.toString());
    channel.ack(msg);
}, { noAck: false });
```

---

## Использование HTTP API вашего приложения

**Endpoint:** `POST http://localhost:5270/api/rabbitmq/publish`

```json
{
  "queueName": "my_queue",
  "message": "Привет из HTTP!"
}
```

### JavaScript
```javascript
fetch('http://localhost:5270/api/rabbitmq/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueName: 'my_queue', message: 'Привет!' })
});
```

### cURL
```bash
curl -X POST http://localhost:5270/api/rabbitmq/publish \
  -H "Content-Type: application/json" \
  -d '{"queueName":"my_queue","message":"Привет!"}'
```

---

## Типичные сценарии

### 1. Отправка из веб-формы
```javascript
// Когда пользователь отправляет форму
const formData = { name: 'Иван', email: 'ivan@example.com' };
await fetch('http://localhost:5270/api/rabbitmq/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        queueName: 'user_registrations',
        message: JSON.stringify(formData)
    })
});
```

### 2. Обработка в фоновом сервисе
```csharp
// Ваш фоновый сервис слушает очередь
var consumer = new EventingBasicConsumer(channel);
consumer.Received += async (model, ea) => {
    var message = Encoding.UTF8.GetString(ea.Body.ToArray());
    var userData = JsonSerializer.Deserialize<UserData>(message);
    
    // Обработка регистрации
    await ProcessUserRegistration(userData);
    
    channel.BasicAck(ea.DeliveryTag, false);
};
channel.BasicConsume("user_registrations", false, consumer);
```

### 3. Интеграция с вашим текущим приложением
```csharp
// Отправьте сообщение в очередь, которую слушает ваше приложение
publisher.PublishMessage("test_queue", "Новое сообщение");
// Ваше приложение автоматически получит его и создаст уведомление
```

---

## Проверка в RabbitMQ Management

1. Откройте http://localhost:15672
2. Перейдите в **Queues and Streams**
3. Найдите вашу очередь
4. Кликните на неё, чтобы увидеть сообщения

---

**Подробное руководство:** см. `RABBITMQ_INTEGRATION.md`

