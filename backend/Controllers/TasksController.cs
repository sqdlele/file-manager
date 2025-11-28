using Microsoft.AspNetCore.Mvc;
using TasksManager.Api.Models;
using TasksManager.Api.Services;

namespace TasksManager.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class TasksController : ControllerBase
{
    private readonly ITaskManagerService _taskManagerService;
    private readonly ILogger<TasksController> _logger;

    public TasksController(ITaskManagerService taskManagerService, ILogger<TasksController> logger)
    {
        _taskManagerService = taskManagerService;
        _logger = logger;
    }

    [HttpPost]
    public async Task<ActionResult<BackgroundTask>> CreateTask([FromBody] CreateTaskRequest request)
    {
        try
        {
            var taskId = await _taskManagerService.StartTaskAsync(request.Name, request.Type, request.Parameters);
            var task = await _taskManagerService.GetTaskAsync(taskId);
            return Ok(task);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error creating task");
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpGet]
    public async Task<ActionResult<List<BackgroundTask>>> GetAllTasks()
    {
        var tasks = await _taskManagerService.GetAllTasksAsync();
        return Ok(tasks);
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<BackgroundTask>> GetTask(string id)
    {
        var task = await _taskManagerService.GetTaskAsync(id);
        if (task == null)
            return NotFound();

        return Ok(task);
    }

    [HttpPost("{id}/stop")]
    public async Task<ActionResult> StopTask(string id)
    {
        var stopped = await _taskManagerService.StopTaskAsync(id);
        if (!stopped)
            return NotFound(new { error = "Task not found or cannot be stopped" });

        return Ok(new { message = "Task stopped successfully" });
    }

    [HttpDelete("{id}")]
    public async Task<ActionResult> DeleteTask(string id)
    {
        var deleted = await _taskManagerService.DeleteTaskAsync(id);
        if (!deleted)
            return NotFound(new { error = "Task not found or cannot be deleted (running tasks cannot be deleted)" });

        return Ok(new { message = "Task deleted successfully" });
    }
}

