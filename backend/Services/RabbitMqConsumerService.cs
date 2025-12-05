using RabbitMQ.Client;
using RabbitMQ.Client.Events;
using System.Text;

namespace TasksManager.Api.Services;

/// <summary>
/// Фоновый сервис для получения сообщений из очереди RabbitMQ
/// </summary>
public class RabbitMqConsumerService : BackgroundService
{
    private readonly IConfiguration _configuration;
    private readonly ILogger<RabbitMqConsumerService> _logger;
    private readonly INotificationService _notificationService;
    private IConnection? _connection;
    private IModel? _channel;
    private readonly string _queueName;

    public RabbitMqConsumerService(
        IConfiguration configuration,
        ILogger<RabbitMqConsumerService> logger,
        INotificationService notificationService)
    {
        _configuration = configuration;
        _logger = logger;
        _notificationService = notificationService;
        _queueName = _configuration["RabbitMQ:ConsumerQueueName"] ?? "test_queue";
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Yield(); // Позволяем методу StartAsync завершиться

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ConnectAndConsumeAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                // Нормальное завершение при отмене
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Ошибка подключения к RabbitMQ. Повторная попытка через 1 минуту...");
                // Повторная попытка каждую минуту
                try
                {
                    await Task.Delay(60000, stoppingToken); // 60 секунд = 1 минута
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }
        }
    }

    private async Task ConnectAndConsumeAsync(CancellationToken stoppingToken)
    {
        var factory = new ConnectionFactory
        {
            HostName = _configuration["RabbitMQ:HostName"] ?? "localhost",
            Port = int.TryParse(_configuration["RabbitMQ:Port"], out var port) ? port : 5672,
            UserName = _configuration["RabbitMQ:UserName"] ?? "guest",
            Password = _configuration["RabbitMQ:Password"] ?? "guest",
            VirtualHost = _configuration["RabbitMQ:VirtualHost"] ?? "/",
            AutomaticRecoveryEnabled = true, // Автоматическое восстановление подключения
            NetworkRecoveryInterval = TimeSpan.FromSeconds(10),
            RequestedConnectionTimeout = TimeSpan.FromSeconds(5)
        };

        _logger.LogInformation("Попытка подключения к RabbitMQ: {HostName}:{Port}", factory.HostName, factory.Port);
        
        try
        {
            _connection = factory.CreateConnection();
            _channel = _connection.CreateModel();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Не удалось подключиться к RabbitMQ. Повторная попытка будет через 1 минуту.");
            throw; // Пробрасываем исключение, чтобы ExecuteAsync мог обработать его
        }

        // Объявляем очередь (если не существует, будет создана)
        _channel.QueueDeclare(
            queue: _queueName,
            durable: true,
            exclusive: false,
            autoDelete: false,
            arguments: null
        );

        // Настраиваем QoS (качество обслуживания) - обрабатываем по одному сообщению за раз
        _channel.BasicQos(prefetchSize: 0, prefetchCount: 1, global: false);

        _logger.LogInformation("RabbitMQ Consumer Service запущен. Ожидание сообщений из очереди '{QueueName}'", _queueName);

        var consumer = new EventingBasicConsumer(_channel);
        consumer.Received += async (model, ea) =>
        {
            var body = ea.Body.ToArray();
            var message = Encoding.UTF8.GetString(body);
            var routingKey = ea.RoutingKey;

            try
            {
                _logger.LogInformation("Получено сообщение из очереди '{QueueName}': {Message}", _queueName, message);

                // Здесь можно добавить обработку сообщения
                await ProcessMessageAsync(message, ea.BasicProperties, stoppingToken);

                // Подтверждаем обработку сообщения
                _channel.BasicAck(deliveryTag: ea.DeliveryTag, multiple: false);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Ошибка при обработке сообщения из очереди '{QueueName}'", _queueName);
                
                // Отклоняем сообщение и не возвращаем его в очередь (если нужно вернуть, используйте BasicNack с requeue: true)
                _channel.BasicNack(deliveryTag: ea.DeliveryTag, multiple: false, requeue: false);
            }
        };

        _channel.BasicConsume(
            queue: _queueName,
            autoAck: false, // Ручное подтверждение обработки
            consumer: consumer
        );

        // Ждем до отмены
        while (!stoppingToken.IsCancellationRequested)
        {
            await Task.Delay(1000, stoppingToken);
        }
    }

    /// <summary>
    /// Обрабатывает полученное сообщение
    /// </summary>
    private async Task ProcessMessageAsync(string message, IBasicProperties properties, CancellationToken cancellationToken)
    {
        _logger.LogInformation("Обработка сообщения: {Message}", message);
        
        // Извлекаем заголовки для метаданных
        var metadata = new Dictionary<string, object>();
        if (properties.Headers != null)
        {
            foreach (var header in properties.Headers)
            {
                _logger.LogDebug("Заголовок: {Key} = {Value}", header.Key, header.Value);
                // Преобразуем значения заголовков в строки для метаданных
                var value = header.Value?.ToString() ?? string.Empty;
                metadata[header.Key] = value;
            }
        }

        // Создаем уведомление о получении сообщения из RabbitMQ
        var title = "Новое сообщение из RabbitMQ";
        if (metadata.TryGetValue("title", out var titleValue))
        {
            title = titleValue.ToString() ?? title;
        }

        await _notificationService.CreateNotificationAsync(
            title: title,
            message: message,
            source: "RabbitMQ",
            metadata: metadata.Count > 0 ? metadata : null
        );
    }

    public override void Dispose()
    {
        _channel?.Close();
        _channel?.Dispose();
        _connection?.Close();
        _connection?.Dispose();
        base.Dispose();
    }
}

