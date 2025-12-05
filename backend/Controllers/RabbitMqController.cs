using Microsoft.AspNetCore.Mvc;
using TasksManager.Api.Services;

namespace TasksManager.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class RabbitMqController : ControllerBase
{
    private readonly IRabbitMqService _rabbitMqService;
    private readonly ILogger<RabbitMqController> _logger;

    public RabbitMqController(IRabbitMqService rabbitMqService, ILogger<RabbitMqController> logger)
    {
        _rabbitMqService = rabbitMqService;
        _logger = logger;
    }

    /// <summary>
    /// Отправляет тестовое сообщение в очередь RabbitMQ
    /// </summary>
    /// <param name="request">Запрос с именем очереди и сообщением</param>
    /// <returns>Результат отправки</returns>
    [HttpPost("publish")]
    public async Task<ActionResult> PublishMessage([FromBody] PublishMessageRequest request)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(request.QueueName))
            {
                return BadRequest(new { error = "QueueName is required" });
            }

            if (string.IsNullOrWhiteSpace(request.Message))
            {
                return BadRequest(new { error = "Message is required" });
            }

            var success = await _rabbitMqService.PublishMessageAsync(
                request.QueueName,
                request.Message,
                request.Headers
            );

            if (success)
            {
                return Ok(new
                {
                    message = "Message published successfully",
                    queueName = request.QueueName,
                    messageContent = request.Message
                });
            }
            else
            {
                return StatusCode(500, new { error = "Failed to publish message" });
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error publishing message to RabbitMQ");
            return StatusCode(500, new { error = ex.Message });
        }
    }
}

/// <summary>
/// Модель запроса для отправки сообщения
/// </summary>
public class PublishMessageRequest
{
    /// <summary>
    /// Имя очереди
    /// </summary>
    public string QueueName { get; set; } = string.Empty;

    /// <summary>
    /// Сообщение для отправки
    /// </summary>
    public string Message { get; set; } = string.Empty;

    /// <summary>
    /// Дополнительные заголовки сообщения (опционально)
    /// </summary>
    public Dictionary<string, object>? Headers { get; set; }
}

