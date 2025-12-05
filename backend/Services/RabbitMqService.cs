using RabbitMQ.Client;
using RabbitMQ.Client.Events;
using System.Text;

namespace TasksManager.Api.Services;

public class RabbitMqService : IRabbitMqService, IDisposable
{
    private readonly IConnection? _connection;
    private readonly IModel? _channel;
    private readonly ILogger<RabbitMqService> _logger;
    private readonly IConfiguration _configuration;

    public RabbitMqService(IConfiguration configuration, ILogger<RabbitMqService> logger)
    {
        _configuration = configuration;
        _logger = logger;

        var factory = new ConnectionFactory
        {
            HostName = _configuration["RabbitMQ:HostName"] ?? "localhost",
            Port = int.TryParse(_configuration["RabbitMQ:Port"], out var port) ? port : 5672,
            UserName = _configuration["RabbitMQ:UserName"] ?? "guest",
            Password = _configuration["RabbitMQ:Password"] ?? "guest",
            VirtualHost = _configuration["RabbitMQ:VirtualHost"] ?? "/"
        };

        try
        {
            factory.RequestedConnectionTimeout = TimeSpan.FromSeconds(5);
            _connection = factory.CreateConnection();
            _channel = _connection.CreateModel();
            _logger.LogInformation("Подключение к RabbitMQ установлено: {HostName}:{Port}", factory.HostName, factory.Port);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Не удалось подключиться к RabbitMQ. Сервис будет работать без RabbitMQ. Убедитесь, что RabbitMQ сервер запущен.");
            // Не бросаем исключение, чтобы приложение могло работать без RabbitMQ
            // Создаем фиктивные объекты, чтобы избежать NullReferenceException
            // В реальности лучше использовать паттерн "lazy connection" или проверять подключение перед использованием
        }
    }

    public async Task<bool> PublishMessageAsync(string queueName, string message)
    {
        return await PublishMessageAsync(queueName, message, null);
    }

    public async Task<bool> PublishMessageAsync(string queueName, string message, Dictionary<string, object>? headers)
    {
        try
        {
            if (_channel == null || _connection == null || !_connection.IsOpen)
            {
                _logger.LogWarning("RabbitMQ не подключен. Сообщение не отправлено: {Message}", message);
                return false;
            }

            // Объявляем очередь (если не существует, будет создана)
            _channel.QueueDeclare(
                queue: queueName,
                durable: true, // Очередь будет сохраняться после перезапуска RabbitMQ
                exclusive: false,
                autoDelete: false,
                arguments: null
            );

            var body = Encoding.UTF8.GetBytes(message);

            var properties = _channel.CreateBasicProperties();
            properties.Persistent = true; // Сообщение будет сохраняться на диск
            properties.Timestamp = new AmqpTimestamp(DateTimeOffset.UtcNow.ToUnixTimeSeconds());

            if (headers != null && headers.Count > 0)
            {
                properties.Headers = new Dictionary<string, object>(headers);
            }

            _channel.BasicPublish(
                exchange: string.Empty, // Используем default exchange
                routingKey: queueName,
                basicProperties: properties,
                body: body
            );

            _logger.LogInformation("Сообщение отправлено в очередь '{QueueName}': {Message}", queueName, message);
            return await Task.FromResult(true);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Ошибка при отправке сообщения в очередь '{QueueName}'", queueName);
            return false;
        }
    }

    public void Dispose()
    {
        _channel?.Close();
        _channel?.Dispose();
        _connection?.Close();
        _connection?.Dispose();
    }
}

