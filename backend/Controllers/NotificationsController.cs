using Microsoft.AspNetCore.Mvc;
using TasksManager.Api.Services;

namespace TasksManager.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class NotificationsController : ControllerBase
{
    private readonly INotificationService _notificationService;
    private readonly ILogger<NotificationsController> _logger;

    public NotificationsController(INotificationService notificationService, ILogger<NotificationsController> logger)
    {
        _notificationService = notificationService;
        _logger = logger;
    }

    [HttpGet]
    public async Task<ActionResult> GetAllNotifications()
    {
        try
        {
            var notifications = await _notificationService.GetAllNotificationsAsync();
            return Ok(notifications);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error getting notifications");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    [HttpGet("unread")]
    public async Task<ActionResult> GetUnreadNotifications()
    {
        try
        {
            var notifications = await _notificationService.GetUnreadNotificationsAsync();
            return Ok(notifications);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error getting unread notifications");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    [HttpGet("unread/count")]
    public async Task<ActionResult> GetUnreadCount()
    {
        try
        {
            var count = await _notificationService.GetUnreadCountAsync();
            return Ok(new { count });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error getting unread count");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    [HttpPost("{id}/read")]
    public async Task<ActionResult> MarkAsRead(string id)
    {
        try
        {
            var success = await _notificationService.MarkAsReadAsync(id);
            if (!success)
                return NotFound(new { error = "Notification not found" });

            return Ok(new { message = "Notification marked as read" });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error marking notification as read");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    [HttpPost("read-all")]
    public async Task<ActionResult> MarkAllAsRead()
    {
        try
        {
            await _notificationService.MarkAllAsReadAsync();
            return Ok(new { message = "All notifications marked as read" });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error marking all notifications as read");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    [HttpDelete("{id}")]
    public async Task<ActionResult> DeleteNotification(string id)
    {
        try
        {
            var success = await _notificationService.DeleteNotificationAsync(id);
            if (!success)
                return NotFound(new { error = "Notification not found" });

            return Ok(new { message = "Notification deleted" });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting notification");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    [HttpDelete]
    public async Task<ActionResult> DeleteAllNotifications()
    {
        try
        {
            await _notificationService.DeleteAllNotificationsAsync();
            return Ok(new { message = "All notifications deleted" });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting all notifications");
            return StatusCode(500, new { error = ex.Message });
        }
    }
}

