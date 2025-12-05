using TasksManager.Api.Models;

namespace TasksManager.Api.Services;

public interface INotificationService
{
    Task<Notification> CreateNotificationAsync(string title, string message, string? source = null, Dictionary<string, object>? metadata = null);
    Task<List<Notification>> GetAllNotificationsAsync();
    Task<List<Notification>> GetUnreadNotificationsAsync();
    Task<int> GetUnreadCountAsync();
    Task<bool> MarkAsReadAsync(string notificationId);
    Task<bool> MarkAllAsReadAsync();
    Task<bool> DeleteNotificationAsync(string notificationId);
    Task<bool> DeleteAllNotificationsAsync();
}

