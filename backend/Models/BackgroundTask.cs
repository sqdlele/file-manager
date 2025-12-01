namespace TasksManager.Api.Models;

public class BackgroundTask
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Name { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public TaskStatus Status { get; set; } = TaskStatus.Pending;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public string? ErrorMessage { get; set; }
    public int Progress { get; set; } = 0;
    public int? MaxValue { get; set; }
    public string? Message { get; set; }
    
    // Метрики процесса (для типа "process")
    public double? CpuUsage { get; set; } // Процент использования CPU
    public long? MemoryUsage { get; set; } // Использование памяти в байтах
    public int? ProcessId { get; set; } // PID процесса
}

