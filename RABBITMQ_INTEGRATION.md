# Интеграция RabbitMQ с другими веб-приложениями

## Содержание
1. [Общие принципы](#общие-принципы)
2. [.NET / C# приложения](#net--c-приложения)
3. [Node.js / JavaScript приложения](#nodejs--javascript-приложения)
4. [Python приложения](#python-приложения)
5. [Java приложения](#java-приложения)
6. [HTTP API для отправки сообщений](#http-api-для-отправки-сообщений)
7. [Примеры использования](#примеры-использования)

---

## Общие принципы

RabbitMQ работает как **брокер сообщений** между приложениями. Основные концепции:

- **Producer (Отправитель)** - приложение, которое отправляет сообщения в очередь
- **Consumer (Получатель)** - приложение, которое получает и обрабатывает сообщения
- **Queue (Очередь)** - место, где хранятся сообщения до обработки
- **Exchange (Обменник)** - маршрутизирует сообщения в очереди
- **Routing Key** - ключ для маршрутизации сообщений

### Подключение к RabbitMQ

**Параметры подключения:**
- **Host:** `localhost` (или IP адрес сервера RabbitMQ)
- **Port:** `5672` (стандартный порт для AMQP)
- **Management UI:** `15672` (веб-интерфейс)
- **Username:** `guest` (по умолчанию)
- **Password:** `guest` (по умолчанию)
- **Virtual Host:** `/` (по умолчанию)

---

## .NET / C# приложения

### Установка пакета

```bash
dotnet add package RabbitMQ.Client
```

### Пример: Отправка сообщений

```csharp
using RabbitMQ.Client;
using System.Text;

public class RabbitMqPublisher
{
    private readonly IConnection _connection;
    private readonly IModel _channel;

    public RabbitMqPublisher(string hostName = "localhost", 
                            int port = 5672,
                            string userName = "guest",
                            string password = "guest")
    {
        var factory = new ConnectionFactory
        {
            HostName = hostName,
            Port = port,
            UserName = userName,
            Password = password,
            VirtualHost = "/"
        };

        _connection = factory.CreateConnection();
        _channel = _connection.CreateModel();
    }

    public void PublishMessage(string queueName, string message)
    {
        // Объявляем очередь (создается, если не существует)
        _channel.QueueDeclare(
            queue: queueName,
            durable: true,      // Очередь сохраняется после перезапуска
            exclusive: false,
            autoDelete: false,
            arguments: null
        );

        var body = Encoding.UTF8.GetBytes(message);

        var properties = _channel.CreateBasicProperties();
        properties.Persistent = true; // Сообщение сохраняется на диск

        // Отправляем сообщение
        _channel.BasicPublish(
            exchange: string.Empty,  // Используем default exchange
            routingKey: queueName,   // Имя очереди как routing key
            basicProperties: properties,
            body: body
        );

        Console.WriteLine($"Сообщение отправлено в очередь '{queueName}': {message}");
    }

    public void Dispose()
    {
        _channel?.Close();
        _channel?.Dispose();
        _connection?.Close();
        _connection?.Dispose();
    }
}

// Использование:
var publisher = new RabbitMqPublisher();
publisher.PublishMessage("my_queue", "Привет из другого приложения!");
publisher.Dispose();
```

### Пример: Получение сообщений

```csharp
using RabbitMQ.Client;
using RabbitMQ.Client.Events;
using System.Text;

public class RabbitMqConsumer
{
    private readonly IConnection _connection;
    private readonly IModel _channel;

    public RabbitMqConsumer(string hostName = "localhost",
                          int port = 5672,
                          string userName = "guest",
                          string password = "guest")
    {
        var factory = new ConnectionFactory
        {
            HostName = hostName,
            Port = port,
            UserName = userName,
            Password = password,
            VirtualHost = "/"
        };

        _connection = factory.CreateConnection();
        _channel = _connection.CreateModel();
    }

    public void StartConsuming(string queueName, Action<string> onMessageReceived)
    {
        // Объявляем очередь
        _channel.QueueDeclare(
            queue: queueName,
            durable: true,
            exclusive: false,
            autoDelete: false,
            arguments: null
        );

        // Настраиваем QoS (качество обслуживания)
        _channel.BasicQos(prefetchSize: 0, prefetchCount: 1, global: false);

        var consumer = new EventingBasicConsumer(_channel);
        
        consumer.Received += (model, ea) =>
        {
            var body = ea.Body.ToArray();
            var message = Encoding.UTF8.GetString(body);
            
            try
            {
                // Обрабатываем сообщение
                onMessageReceived(message);
                
                // Подтверждаем обработку
                _channel.BasicAck(deliveryTag: ea.DeliveryTag, multiple: false);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Ошибка обработки сообщения: {ex.Message}");
                // Отклоняем сообщение (можно вернуть в очередь с requeue: true)
                _channel.BasicNack(deliveryTag: ea.DeliveryTag, multiple: false, requeue: true);
            }
        };

        _channel.BasicConsume(
            queue: queueName,
            autoAck: false,  // Ручное подтверждение
            consumer: consumer
        );

        Console.WriteLine($"Ожидание сообщений из очереди '{queueName}'. Нажмите [Enter] для выхода.");
        Console.ReadLine();
    }

    public void Dispose()
    {
        _channel?.Close();
        _channel?.Dispose();
        _connection?.Close();
        _connection?.Dispose();
    }
}

// Использование:
var consumer = new RabbitMqConsumer();
consumer.StartConsuming("my_queue", (message) =>
{
    Console.WriteLine($"Получено сообщение: {message}");
    // Ваша логика обработки
});
consumer.Dispose();
```

---

## Node.js / JavaScript приложения

### Установка пакета

```bash
npm install amqplib
```

### Пример: Отправка сообщений

```javascript
const amqp = require('amqplib');

async function publishMessage(queueName, message) {
    try {
        // Подключаемся к RabbitMQ
        const connection = await amqp.connect('amqp://guest:guest@localhost:5672');
        const channel = await connection.createChannel();

        // Объявляем очередь
        await channel.assertQueue(queueName, {
            durable: true  // Очередь сохраняется после перезапуска
        });

        // Отправляем сообщение
        channel.sendToQueue(queueName, Buffer.from(message), {
            persistent: true  // Сообщение сохраняется на диск
        });

        console.log(`Сообщение отправлено в очередь '${queueName}': ${message}`);

        // Закрываем соединение
        setTimeout(() => {
            connection.close();
        }, 500);
    } catch (error) {
        console.error('Ошибка отправки сообщения:', error);
    }
}

// Использование:
publishMessage('my_queue', 'Привет из Node.js!');
```

### Пример: Получение сообщений

```javascript
const amqp = require('amqplib');

async function consumeMessages(queueName) {
    try {
        // Подключаемся к RabbitMQ
        const connection = await amqp.connect('amqp://guest:guest@localhost:5672');
        const channel = await connection.createChannel();

        // Объявляем очередь
        await channel.assertQueue(queueName, {
            durable: true
        });

        // Настраиваем QoS
        channel.prefetch(1);

        console.log(`Ожидание сообщений из очереди '${queueName}'...`);

        // Получаем сообщения
        channel.consume(queueName, (msg) => {
            if (msg) {
                const message = msg.content.toString();
                console.log(`Получено сообщение: ${message}`);

                // Ваша логика обработки
                // ...

                // Подтверждаем обработку
                channel.ack(msg);
            }
        }, {
            noAck: false  // Ручное подтверждение
        });
    } catch (error) {
        console.error('Ошибка получения сообщений:', error);
    }
}

// Использование:
consumeMessages('my_queue');
```

### Express.js пример (REST API для отправки)

```javascript
const express = require('express');
const amqp = require('amqplib');

const app = express();
app.use(express.json());

let channel;

// Подключаемся к RabbitMQ при старте
amqp.connect('amqp://guest:guest@localhost:5672')
    .then(connection => connection.createChannel())
    .then(ch => {
        channel = ch;
        console.log('Подключено к RabbitMQ');
    })
    .catch(err => {
        console.error('Ошибка подключения к RabbitMQ:', err);
    });

// API endpoint для отправки сообщений
app.post('/api/send-message', async (req, res) => {
    const { queueName, message } = req.body;

    if (!queueName || !message) {
        return res.status(400).json({ error: 'queueName и message обязательны' });
    }

    try {
        await channel.assertQueue(queueName, { durable: true });
        channel.sendToQueue(queueName, Buffer.from(message), { persistent: true });
        
        res.json({ 
            success: true, 
            message: 'Сообщение отправлено',
            queueName,
            messageContent: message
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(3000, () => {
    console.log('Сервер запущен на порту 3000');
});
```

---

## Java приложения

### Добавление зависимости (Maven)

```xml
<dependency>
    <groupId>com.rabbitmq</groupId>
    <artifactId>amqp-client</artifactId>
    <version>5.20.0</version>
</dependency>
```

### Пример: Отправка сообщений

```java
import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;

public class RabbitMqPublisher {
    private static final String QUEUE_NAME = "my_queue";

    public static void main(String[] args) throws Exception {
        ConnectionFactory factory = new ConnectionFactory();
        factory.setHost("localhost");
        factory.setPort(5672);
        factory.setUsername("guest");
        factory.setPassword("guest");
        factory.setVirtualHost("/");

        try (Connection connection = factory.newConnection();
             Channel channel = connection.createChannel()) {

            // Объявляем очередь
            channel.queueDeclare(QUEUE_NAME, true, false, false, null);

            String message = "Привет из Java!";

            // Отправляем сообщение
            channel.basicPublish("", QUEUE_NAME, 
                new AMQP.BasicProperties.Builder()
                    .deliveryMode(2)  // Сообщение сохраняется на диск
                    .build(),
                message.getBytes("UTF-8"));

            System.out.println("Сообщение отправлено: " + message);
        }
    }
}
```

### Пример: Получение сообщений

```java
import com.rabbitmq.client.*;

public class RabbitMqConsumer {
    private static final String QUEUE_NAME = "my_queue";

    public static void main(String[] args) throws Exception {
        ConnectionFactory factory = new ConnectionFactory();
        factory.setHost("localhost");
        factory.setPort(5672);
        factory.setUsername("guest");
        factory.setPassword("guest");
        factory.setVirtualHost("/");

        Connection connection = factory.newConnection();
        Channel channel = connection.createChannel();

        // Объявляем очередь
        channel.queueDeclare(QUEUE_NAME, true, false, false, null);

        // Настраиваем QoS
        channel.basicQos(1);

        System.out.println("Ожидание сообщений из очереди '" + QUEUE_NAME + "'...");

        DeliverCallback deliverCallback = (consumerTag, delivery) -> {
            String message = new String(delivery.getBody(), "UTF-8");
            System.out.println("Получено сообщение: " + message);

            // Ваша логика обработки
            // ...

            // Подтверждаем обработку
            channel.basicAck(delivery.getEnvelope().getDeliveryTag(), false);
        };

        channel.basicConsume(QUEUE_NAME, false, deliverCallback, consumerTag -> {});

        // Ждем сообщения
        Thread.sleep(Long.MAX_VALUE);
    }
}
```

---

## HTTP API для отправки сообщений

Если у вас есть доступ к вашему текущему приложению, вы можете использовать его API для отправки сообщений из любого языка:

### Endpoint

**POST** `http://localhost:5270/api/rabbitmq/publish`

**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "queueName": "my_queue",
  "message": "Привет из другого приложения!"
}
```

### Примеры использования

#### cURL
```bash
curl -X POST http://localhost:5270/api/rabbitmq/publish \
  -H "Content-Type: application/json" \
  -d '{"queueName":"my_queue","message":"Привет из cURL!"}'
```

#### PowerShell
```powershell
$body = @{
    queueName = "my_queue"
    message = "Привет из PowerShell!"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:5270/api/rabbitmq/publish" `
    -Method Post -ContentType "application/json" -Body $body
```

#### JavaScript (Fetch API)
```javascript
fetch('http://localhost:5270/api/rabbitmq/publish', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        queueName: 'my_queue',
        message: 'Привет из JavaScript!'
    })
})
.then(response => response.json())
.then(data => console.log(data));
```

---

## Примеры использования

### Сценарий 1: Микросервисная архитектура

**Сервис A (отправитель):**
```csharp
// При создании заказа
var orderService = new RabbitMqPublisher();
orderService.PublishMessage("orders_queue", JsonSerializer.Serialize(newOrder));
```

**Сервис B (получатель):**
```csharp
// Обрабатывает заказы
var orderProcessor = new RabbitMqConsumer();
orderProcessor.StartConsuming("orders_queue", (message) =>
{
    var order = JsonSerializer.Deserialize<Order>(message);
    ProcessOrder(order);
});
```

### Сценарий 2: Уведомления между приложениями

**Веб-приложение отправляет уведомление:**
```javascript
// Когда пользователь выполняет действие
await publishMessage('notifications_queue', JSON.stringify({
    userId: 123,
    type: 'order_placed',
    message: 'Ваш заказ создан'
}));
```

**Сервис уведомлений получает и обрабатывает:**
```javascript
consumeMessages('notifications_queue', (message) => {
    const notification = JSON.parse(message);
    sendEmail(notification.userId, notification.message);
    sendSMS(notification.userId, notification.message);
});
```

### Сценарий 3: Очередь задач

**Фронтенд отправляет задачу:**
```javascript
// Пользователь загружает файл
fetch('/api/process-file', {
    method: 'POST',
    body: formData
});

// Backend добавляет в очередь
await publishMessage('file_processing_queue', JSON.stringify({
    fileId: file.id,
    filePath: file.path,
    userId: user.id
}));
```

### Сценарий 4: Интеграция с вашим текущим приложением

Ваше текущее приложение уже слушает очередь `test_queue`. Вы можете отправлять сообщения в эту очередь из любого другого приложения:

```csharp
// Из другого .NET приложения
var publisher = new RabbitMqPublisher();
publisher.PublishMessage("test_queue", "Сообщение для вашего приложения");
// Ваше приложение получит это сообщение и создаст уведомление
```

---

## Настройка подключения

### Локальная разработка

```csharp
// .NET
var factory = new ConnectionFactory
{
    HostName = "localhost",
    Port = 5672,
    UserName = "guest",
    Password = "guest"
};
```

### Удаленный сервер

```csharp
// .NET
var factory = new ConnectionFactory
{
    HostName = "rabbitmq.example.com",
    Port = 5672,
    UserName = "your_username",
    Password = "your_password",
    VirtualHost = "/"
};
```

### Docker контейнер

Если RabbitMQ запущен в Docker, используйте:
- **Host:** `localhost` (если порт проброшен)
- **Host:** `rabbitmq` (если приложения в одной Docker сети)

---

## 📚 Полезные ссылки

- **Официальная документация RabbitMQ:** https://www.rabbitmq.com/documentation.html
- **RabbitMQ Tutorials:** https://www.rabbitmq.com/getstarted.html
- **RabbitMQ Management UI:** http://localhost:15672 (guest/guest)

---

**Готово! Теперь вы можете интегрировать RabbitMQ с любым веб-приложением!**

