namespace TasksManager.Api.Services;

public interface IRabbitMqService
{
    /// <summary>
    /// Отправляет сообщение в очередь RabbitMQ
    /// </summary>
    /// <param name="queueName">Имя очереди</param>
    /// <param name="message">Сообщение для отправки</param>
    /// <returns>True если сообщение успешно отправлено</returns>
    Task<bool> PublishMessageAsync(string queueName, string message);

    /// <summary>
    /// Отправляет сообщение в очередь RabbitMQ с дополнительными параметрами
    /// </summary>
    /// <param name="queueName">Имя очереди</param>
    /// <param name="message">Сообщение для отправки</param>
    /// <param name="headers">Дополнительные заголовки сообщения</param>
    /// <returns>True если сообщение успешно отправлено</returns>
    Task<bool> PublishMessageAsync(string queueName, string message, Dictionary<string, object>? headers);
}

