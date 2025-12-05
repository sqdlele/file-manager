using TasksManager.Api.Models;

namespace TasksManager.Api.Services;

public interface ITaskManagerService
{
    Task<string> StartTaskAsync(string name, string type, Dictionary<string, string>? parameters = null);
    Task<bool> StopTaskAsync(string taskId);
    Task<bool> PauseTaskAsync(string taskId);
    Task<bool> ResumeTaskAsync(string taskId);
    Task<bool> DeleteTaskAsync(string taskId);
    Task<BackgroundTask?> GetTaskAsync(string taskId);
    Task<List<BackgroundTask>> GetAllTasksAsync();
}

