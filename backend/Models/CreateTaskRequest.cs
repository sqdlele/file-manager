namespace TasksManager.Api.Models;

public class CreateTaskRequest
{
    public string Name { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public Dictionary<string, string>? Parameters { get; set; }
}

