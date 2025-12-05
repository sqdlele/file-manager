using System.Collections.Concurrent;
using TasksManager.Api.Models;
using TasksManager.Api.Hubs;
using Microsoft.AspNetCore.SignalR;

namespace TasksManager.Api.Services;

public class NotificationService : INotificationService
{
    private readonly ConcurrentDictionary<string, Notification> _notifications = new();
    private readonly IHubContext<TaskHub> _hubContext;
    private readonly ILogger<NotificationService> _logger;

    public NotificationService(IHubContext<TaskHub> hubContext, ILogger<NotificationService> logger)
    {
        _hubContext = hubContext;
        _logger = logger;
    }

    public async Task<Notification> CreateNotificationAsync(string title, string message, string? source = null, Dictionary<string, object>? metadata = null)
    {
        var notification = new Notification
        {
            Id = Guid.NewGuid().ToString(),
            Title = title,
            Message = message,
            CreatedAt = DateTime.UtcNow,
            IsRead = false,
            Source = source ?? "System",
            Metadata = metadata
        };

        _notifications[notification.Id] = notification;

        // Отправляем уведомление через SignalR всем подключенным клиентам
        await _hubContext.Clients.All.SendAsync("NotificationReceived", notification);

        _logger.LogInformation("Создано уведомление: {Title} - {Message}", title, message);

        return notification;
    }

    public Task<List<Notification>> GetAllNotificationsAsync()
    {
        return Task.FromResult(_notifications.Values
            .OrderByDescending(n => n.CreatedAt)
            .ToList());
    }

    public Task<List<Notification>> GetUnreadNotificationsAsync()
    {
        return Task.FromResult(_notifications.Values
            .Where(n => !n.IsRead)
            .OrderByDescending(n => n.CreatedAt)
            .ToList());
    }

    public Task<int> GetUnreadCountAsync()
    {
        return Task.FromResult(_notifications.Values.Count(n => !n.IsRead));
    }

    public async Task<bool> MarkAsReadAsync(string notificationId)
    {
        if (_notifications.TryGetValue(notificationId, out var notification))
        {
            notification.IsRead = true;
            // Отправляем обновление через SignalR
            await _hubContext.Clients.All.SendAsync("NotificationUpdated", notification);
            return true;
        }
        return false;
    }

    public async Task<bool> MarkAllAsReadAsync()
    {
        var updated = false;
        foreach (var notification in _notifications.Values.Where(n => !n.IsRead))
        {
            notification.IsRead = true;
            updated = true;
        }

        if (updated)
        {
            // Отправляем обновление счетчика через SignalR
            var unreadCount = await GetUnreadCountAsync();
            await _hubContext.Clients.All.SendAsync("NotificationCountUpdated", unreadCount);
        }

        return updated;
    }

    public Task<bool> DeleteNotificationAsync(string notificationId)
    {
        return Task.FromResult(_notifications.TryRemove(notificationId, out _));
    }

    public Task<bool> DeleteAllNotificationsAsync()
    {
        _notifications.Clear();
        return Task.FromResult(true);
    }
}

