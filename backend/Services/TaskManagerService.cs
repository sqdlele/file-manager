using System.Collections.Concurrent;
using TasksManager.Api.Models;
using TasksManager.Api.Hubs;
using Microsoft.AspNetCore.SignalR;

namespace TasksManager.Api.Services;

public class TaskManagerService : ITaskManagerService
{
    private readonly ConcurrentDictionary<string, BackgroundTask> _tasks = new();
    private readonly ConcurrentDictionary<string, CancellationTokenSource> _cancellationTokens = new();
    private readonly IHubContext<TaskHub> _hubContext;
    private readonly ILogger<TaskManagerService> _logger;

    public TaskManagerService(IHubContext<TaskHub> hubContext, ILogger<TaskManagerService> logger)
    {
        _hubContext = hubContext;
        _logger = logger;
    }

    public async Task<string> StartTaskAsync(string name, string type, Dictionary<string, string>? parameters = null)
    {
        var task = new BackgroundTask
        {
            Id = Guid.NewGuid().ToString(),
            Name = name,
            Type = type,
            Status = Models.TaskStatus.Pending,
            CreatedAt = DateTime.UtcNow
        };

        _tasks[task.Id] = task;
        var cts = new CancellationTokenSource();
        _cancellationTokens[task.Id] = cts;

        await NotifyTaskUpdateAsync(task);

        // Запускаем задачу в фоне
        _ = RunTaskAsync(task, parameters ?? new Dictionary<string, string>(), cts.Token);

        return task.Id;
    }

    public async Task<bool> StopTaskAsync(string taskId)
    {
        if (!_tasks.TryGetValue(taskId, out var task))
            return false;

        if (task.Status != Models.TaskStatus.Running)
            return false;

        if (_cancellationTokens.TryGetValue(taskId, out var cts))
        {
            cts.Cancel();
            task.Status = Models.TaskStatus.Cancelled;
            task.CompletedAt = DateTime.UtcNow;
            await NotifyTaskUpdateAsync(task);
            return true;
        }

        return false;
    }

    public Task<bool> DeleteTaskAsync(string taskId)
    {
        if (!_tasks.TryGetValue(taskId, out var task))
            return Task.FromResult(false);

        // Нельзя удалять выполняющиеся задачи
        if (task.Status == Models.TaskStatus.Running)
            return Task.FromResult(false);

        // Удаляем задачу из словаря
        _tasks.TryRemove(taskId, out _);
        _cancellationTokens.TryRemove(taskId, out _);

        return Task.FromResult(true);
    }

    public Task<BackgroundTask?> GetTaskAsync(string taskId)
    {
        _tasks.TryGetValue(taskId, out var task);
        return Task.FromResult(task);
    }

    public Task<List<BackgroundTask>> GetAllTasksAsync()
    {
        return Task.FromResult(_tasks.Values.OrderByDescending(t => t.CreatedAt).ToList());
    }

    private async Task RunTaskAsync(BackgroundTask task, Dictionary<string, string> parameters, CancellationToken cancellationToken)
    {
        try
        {
            task.Status = Models.TaskStatus.Running;
            task.StartedAt = DateTime.UtcNow;
            await NotifyTaskUpdateAsync(task);

            // Выполняем задачу в зависимости от типа
            switch (task.Type.ToLower())
            {
                case "fileprocessor":
                    await RunFileProcessorTaskAsync(task, parameters, cancellationToken);
                    break;
                case "datagenerator":
                    await RunDataGeneratorTaskAsync(task, parameters, cancellationToken);
                    break;
                case "alarm":
                case "reminder":
                    await RunAlarmTaskAsync(task, parameters, cancellationToken);
                    break;
                case "scheduler":
                    await RunSchedulerTaskAsync(task, parameters, cancellationToken);
                    break;
                default:
                    throw new NotSupportedException($"Task type '{task.Type}' is not supported");
            }

            if (!cancellationToken.IsCancellationRequested)
            {
                task.Status = Models.TaskStatus.Completed;
                // Устанавливаем Progress на максимальное значение при завершении
                if (task.MaxValue.HasValue)
                {
                    task.Progress = task.MaxValue.Value;
                }
                task.CompletedAt = DateTime.UtcNow;
                task.Message = "Задача успешно завершена";
            }
        }
        catch (OperationCanceledException)
        {
            task.Status = Models.TaskStatus.Cancelled;
            task.CompletedAt = DateTime.UtcNow;
            task.Message = "Задача отменена";
        }
        catch (Exception ex)
        {
            task.Status = Models.TaskStatus.Failed;
            task.ErrorMessage = ex.Message;
            task.CompletedAt = DateTime.UtcNow;
            _logger.LogError(ex, "Task {TaskId} failed", task.Id);
        }
        finally
        {
            await NotifyTaskUpdateAsync(task);
            _cancellationTokens.TryRemove(task.Id, out _);
        }
    }

    private async Task RunFileProcessorTaskAsync(BackgroundTask task, Dictionary<string, string> parameters, CancellationToken cancellationToken)
    {
        var fileCount = int.TryParse(parameters.GetValueOrDefault("fileCount", "10"), out var count) ? count : 10;
        var delayMs = int.TryParse(parameters.GetValueOrDefault("delayMs", "1000"), out var delay) ? delay : 1000;
        
        task.MaxValue = fileCount;

        for (int i = 1; i <= fileCount; i++)
        {
            cancellationToken.ThrowIfCancellationRequested();

            task.Progress = i; // Храним текущее значение, а не процент
            task.Message = $"Обработка файла {i}/{fileCount}";
            await NotifyTaskUpdateAsync(task);

            await Task.Delay(delayMs, cancellationToken);
        }
    }

    private async Task RunDataGeneratorTaskAsync(BackgroundTask task, Dictionary<string, string> parameters, CancellationToken cancellationToken)
    {
        var itemCount = int.TryParse(parameters.GetValueOrDefault("itemCount", "50"), out var count) ? count : 50;
        var delayMs = int.TryParse(parameters.GetValueOrDefault("delayMs", "300"), out var delay) ? delay : 300;
        
        task.MaxValue = itemCount;

        for (int i = 1; i <= itemCount; i++)
        {
            cancellationToken.ThrowIfCancellationRequested();

            task.Progress = i; // Храним текущее значение, а не процент
            task.Message = $"Генерация элемента данных {i}/{itemCount}";
            await NotifyTaskUpdateAsync(task);

            await Task.Delay(delayMs, cancellationToken);
        }
    }

    private async Task RunAlarmTaskAsync(BackgroundTask task, Dictionary<string, string> parameters, CancellationToken cancellationToken)
    {
        // Парсим время срабатывания (принимаем ISO строку datetime)
        if (!parameters.TryGetValue("alarmTime", out var alarmTimeStr) || 
            !DateTime.TryParse(alarmTimeStr, out var alarmTime))
        {
            throw new ArgumentException("alarmTime parameter is required and must be a valid datetime");
        }

        var message = parameters.GetValueOrDefault("message", "Время пришло!");
        
        // Конвертируем в UTC если нужно
        if (alarmTime.Kind == DateTimeKind.Unspecified)
        {
            alarmTime = DateTime.SpecifyKind(alarmTime, DateTimeKind.Utc);
        }
        
        var alarmTimeUtc = alarmTime.ToUniversalTime();
        var now = DateTime.UtcNow;

        if (alarmTimeUtc <= now)
        {
            throw new ArgumentException("Alarm time must be in the future");
        }

        var timeUntilAlarm = alarmTimeUtc - now;
        var hours = (int)timeUntilAlarm.TotalHours;
        var minutes = timeUntilAlarm.Minutes;
        var seconds = timeUntilAlarm.Seconds;
        
        task.Message = $"Будильник установлен. Осталось: {hours}ч {minutes}м {seconds}с";
        await NotifyTaskUpdateAsync(task);

        // Ждем до времени срабатывания, проверяя каждую секунду
        var totalSeconds = (int)timeUntilAlarm.TotalSeconds;
        var checkInterval = TimeSpan.FromSeconds(1);

        for (int i = 0; i < totalSeconds; i++)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var remaining = timeUntilAlarm - TimeSpan.FromSeconds(i);
            task.Progress = (int)((double)i / totalSeconds * 100);
            task.Message = $"Будильник: {alarmTime:HH:mm:ss}. Осталось: {remaining:hh\\:mm\\:ss}";
            await NotifyTaskUpdateAsync(task);

            // Ждем 1 секунду или до отмены
            await Task.Delay(checkInterval, cancellationToken);
        }

        // Время пришло!
        task.Message = message;
        task.Progress = 100;
        await NotifyTaskUpdateAsync(task);

        // Отправляем специальное событие для уведомления
        await _hubContext.Clients.All.SendAsync("AlarmTriggered", new
        {
            taskId = task.Id,
            taskName = task.Name,
            message = message,
            triggeredAt = DateTime.UtcNow
        });
    }

    private async Task RunSchedulerTaskAsync(BackgroundTask task, Dictionary<string, string> parameters, CancellationToken cancellationToken)
    {
        // Парсим параметры расписания
        var intervalSeconds = int.TryParse(parameters.GetValueOrDefault("intervalSeconds", "60"), out var interval) ? interval : 60;
        var executionCount = int.TryParse(parameters.GetValueOrDefault("executionCount", "10"), out var count) ? count : 10;
        var command = parameters.GetValueOrDefault("command", "echo 'Task executed'");
        
        task.MaxValue = executionCount;
        task.Message = $"Планировщик: выполнение команды каждые {intervalSeconds} секунд. Всего выполнений: {executionCount}";
        await NotifyTaskUpdateAsync(task);

        for (int i = 1; i <= executionCount; i++)
        {
            cancellationToken.ThrowIfCancellationRequested();

            // Имитация выполнения команды
            task.Progress = i;
            task.Message = $"Выполнение команды {i}/{executionCount}: {command}";
            await NotifyTaskUpdateAsync(task);

            // Ждем указанный интервал (кроме последней итерации)
            if (i < executionCount)
            {
                await Task.Delay(TimeSpan.FromSeconds(intervalSeconds), cancellationToken);
            }
        }

        task.Message = $"Планировщик завершен. Выполнено {executionCount} команд";
        await NotifyTaskUpdateAsync(task);
    }

    private async Task NotifyTaskUpdateAsync(BackgroundTask task)
    {
        await _hubContext.Clients.All.SendAsync("TaskUpdated", task);
    }
}

