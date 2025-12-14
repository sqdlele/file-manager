namespace AuthApp.Services;

public interface IRabbitMqService
{
    Task<bool> PublishMessageAsync(string queueName, string message);
    void Dispose();
}

