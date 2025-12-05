namespace TasksManager.Api.Models;

public class Notification
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Title { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public bool IsRead { get; set; } = false;
    public string? Source { get; set; } // Источник уведомления, например "RabbitMQ"
    public Dictionary<string, object>? Metadata { get; set; } // Дополнительные данные
}

