using System.Collections.Concurrent;
using System.Diagnostics;
using System.ComponentModel;
using TasksManager.Api.Models;
using TasksManager.Api.Hubs;
using Microsoft.AspNetCore.SignalR;
using Windows.UI.Notifications;
using Windows.Data.Xml.Dom;

namespace TasksManager.Api.Services;

public class TaskManagerService : ITaskManagerService
{
    private readonly ConcurrentDictionary<string, BackgroundTask> _tasks = new();
    private readonly ConcurrentDictionary<string, CancellationTokenSource> _cancellationTokens = new();
    private readonly ConcurrentDictionary<string, Process> _runningProcesses = new();
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

        // Если это процесс, завершаем его
        if (task.Type.ToLower() == "process" && _runningProcesses.TryGetValue(taskId, out var process))
        {
            try
            {
                var processId = process.Id;
                if (!process.HasExited)
                {
                    process.Kill();
                    await process.WaitForExitAsync();
                }
                _runningProcesses.TryRemove(taskId, out _);
                process.Dispose();
                
                // Показываем уведомление об остановке процесса
                ShowWindowsToastNotification(
                    task.Name,
                    $"Процесс остановлен пользователем\nPID: {processId}"
                );
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Не удалось завершить процесс {TaskId}", taskId);
            }
        }

        if (_cancellationTokens.TryGetValue(taskId, out var cts))
        {
            cts.Cancel();
            task.Status = Models.TaskStatus.Cancelled;
            task.CompletedAt = DateTime.UtcNow;
            task.Message = "Процесс остановлен";
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
                case "alarm":
                case "reminder":
                    await RunAlarmTaskAsync(task, parameters, cancellationToken);
                    break;
                case "scheduler":
                    await RunSchedulerTaskAsync(task, parameters, cancellationToken);
                    break;
                case "process":
                    await RunProcessTaskAsync(task, parameters, cancellationToken);
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

        // Отправляем системное уведомление Windows
        ShowWindowsToastNotification(task.Name, message);

        // Отправляем специальное событие для уведомления в браузере
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
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("Планировщик задач поддерживается только на Windows");
        }

        // Парсим параметры расписания
        var scheduleMode = parameters.GetValueOrDefault("scheduleMode", "interval").ToLower(); // "interval" или "delayed"
        var intervalSeconds = int.TryParse(parameters.GetValueOrDefault("intervalSeconds", "60"), out var interval) ? interval : 60;
        var executionCount = int.TryParse(parameters.GetValueOrDefault("executionCount", "10"), out var count) ? count : 10;
        var executablePath = parameters.GetValueOrDefault("executablePath", string.Empty);
        var arguments = parameters.GetValueOrDefault("arguments", string.Empty);
        var workingDirectory = parameters.GetValueOrDefault("workingDirectory", string.Empty);
        
        // Параметры для режима "delayed"
        var delayBeforeStart = int.TryParse(parameters.GetValueOrDefault("delayBeforeStart", "0"), out var delay) ? delay : 0;
        var runDuration = int.TryParse(parameters.GetValueOrDefault("runDuration", "60"), out var duration) ? duration : 60;

        if (string.IsNullOrWhiteSpace(executablePath))
        {
            throw new ArgumentException("Параметр 'executablePath' обязателен для планировщика задач");
        }

        // Очищаем путь
        executablePath = executablePath.Trim().Trim('"', '\'');

        // Проверяем существование файла
        bool fileExists = false;
        string? resolvedPath = null;

        if (File.Exists(executablePath))
        {
            fileExists = true;
            resolvedPath = Path.GetFullPath(executablePath);
        }
        else if (IsExecutableInPath(executablePath, out resolvedPath))
        {
            fileExists = true;
        }
        else if (!Path.IsPathRooted(executablePath))
        {
            var currentDir = Directory.GetCurrentDirectory();
            var relativePath = Path.Combine(currentDir, executablePath);
            if (File.Exists(relativePath))
            {
                fileExists = true;
                resolvedPath = Path.GetFullPath(relativePath);
            }
        }

        if (!fileExists)
        {
            throw new FileNotFoundException($"Исполняемый файл не найден: {executablePath}");
        }

        executablePath = resolvedPath ?? executablePath;

        // Выбираем режим работы
        if (scheduleMode == "delayed")
        {
            await RunDelayedSchedulerTaskAsync(task, executablePath, arguments, workingDirectory, delayBeforeStart, runDuration, cancellationToken);
            return;
        }

        // Режим "interval" - запуск через интервалы
        task.MaxValue = executionCount;
        task.Message = $"Планировщик: запуск '{Path.GetFileName(executablePath)}' каждые {intervalSeconds} секунд. Всего выполнений: {executionCount}";
        await NotifyTaskUpdateAsync(task);

        var successfulRuns = 0;
        var failedRuns = 0;

        for (int i = 1; i <= executionCount; i++)
        {
            cancellationToken.ThrowIfCancellationRequested();

            task.Progress = i;
            task.Message = $"Запуск программы {i}/{executionCount}: {Path.GetFileName(executablePath)}";
            await NotifyTaskUpdateAsync(task);

            try
            {
                var processStartInfo = new ProcessStartInfo
                {
                    FileName = executablePath,
                    Arguments = arguments,
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };

                if (!string.IsNullOrWhiteSpace(workingDirectory) && Directory.Exists(workingDirectory))
                {
                    processStartInfo.WorkingDirectory = workingDirectory;
                }

                using var process = Process.Start(processStartInfo);
                if (process == null)
                {
                    throw new InvalidOperationException("Не удалось запустить процесс");
                }

                // Не ждем завершения процесса - запускаем и продолжаем
                // Процесс будет работать независимо
                successfulRuns++;
                task.Message = $"Программа {i}/{executionCount} запущена успешно (PID: {process.Id})";
                
                // Показываем уведомление о запуске
                ShowWindowsToastNotification(
                    task.Name,
                    $"Запущена программа {i}/{executionCount}\n{Path.GetFileName(executablePath)}"
                );
            }
            catch (Win32Exception win32Ex)
            {
                failedRuns++;
                var errorMsg = $"Ошибка запуска программы {i}/{executionCount}: {win32Ex.Message}";
                
                // Проверяем, нужны ли права администратора
                if (win32Ex.NativeErrorCode == 5 || // ERROR_ACCESS_DENIED
                    win32Ex.Message.Contains("доступ", StringComparison.OrdinalIgnoreCase) ||
                    win32Ex.Message.Contains("access denied", StringComparison.OrdinalIgnoreCase) ||
                    win32Ex.Message.Contains("права", StringComparison.OrdinalIgnoreCase) ||
                    win32Ex.Message.Contains("permission", StringComparison.OrdinalIgnoreCase))
                {
                    errorMsg += "\n⚠️ ТРЕБУЮТСЯ ПРАВА АДМИНИСТРАТОРА!";
                    task.ErrorMessage = errorMsg;
                }
                else
                {
                    task.ErrorMessage = errorMsg;
                }
                
                _logger.LogWarning(win32Ex, "Ошибка запуска программы в планировщике {TaskId}, выполнение {Execution}", task.Id, i);
            }
            catch (Exception ex)
            {
                failedRuns++;
                task.ErrorMessage = $"Ошибка запуска программы {i}/{executionCount}: {ex.Message}";
                _logger.LogWarning(ex, "Ошибка запуска программы в планировщике {TaskId}, выполнение {Execution}", task.Id, i);
            }

            await NotifyTaskUpdateAsync(task);

            // Ждем указанный интервал (кроме последней итерации)
            if (i < executionCount)
            {
                await Task.Delay(TimeSpan.FromSeconds(intervalSeconds), cancellationToken);
            }
        }

        task.Message = $"Планировщик завершен. Успешно запущено: {successfulRuns}, с ошибками: {failedRuns}";
        if (failedRuns > 0 && task.ErrorMessage != null && task.ErrorMessage.Contains("ПРАВА АДМИНИСТРАТОРА"))
        {
            task.Status = Models.TaskStatus.Failed;
        }
        await NotifyTaskUpdateAsync(task);
    }

    private async Task RunDelayedSchedulerTaskAsync(BackgroundTask task, string executablePath, string arguments, string workingDirectory, int delayBeforeStart, int runDuration, CancellationToken cancellationToken)
    {
        task.MaxValue = 100;
        task.Message = $"Ожидание запуска программы через {delayBeforeStart} секунд...";
        await NotifyTaskUpdateAsync(task);

        // Ждем задержку перед запуском
        if (delayBeforeStart > 0)
        {
            var delaySteps = Math.Min(100, delayBeforeStart);
            var stepDelay = delayBeforeStart / (double)delaySteps;

            for (int i = 0; i < delaySteps; i++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                task.Progress = (int)((i + 1) * 100.0 / delaySteps);
                var remaining = delayBeforeStart - (int)((i + 1) * stepDelay);
                task.Message = $"Ожидание запуска... Осталось: {remaining} секунд";
                await NotifyTaskUpdateAsync(task);
                await Task.Delay(TimeSpan.FromSeconds(stepDelay), cancellationToken);
            }
        }

        // Запускаем программу
        task.Message = $"Запуск программы '{Path.GetFileName(executablePath)}'...";
        task.Progress = 50;
        await NotifyTaskUpdateAsync(task);

        Process? process = null;
        try
        {
            var processStartInfo = new ProcessStartInfo
            {
                FileName = executablePath,
                Arguments = arguments,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = false, // Показываем окно программы
                WindowStyle = ProcessWindowStyle.Normal
            };

            if (!string.IsNullOrWhiteSpace(workingDirectory) && Directory.Exists(workingDirectory))
            {
                processStartInfo.WorkingDirectory = workingDirectory;
            }

            process = Process.Start(processStartInfo);
            if (process == null)
            {
                throw new InvalidOperationException("Не удалось запустить процесс");
            }

            task.Progress = 60;
            task.Message = $"Программа запущена (PID: {process.Id}). Будет закрыта через {runDuration} секунд";
            await NotifyTaskUpdateAsync(task);

            // Показываем уведомление о запуске
            ShowWindowsToastNotification(
                task.Name,
                $"Программа запущена\n{Path.GetFileName(executablePath)}\nБудет закрыта через {runDuration} секунд"
            );

            // Ждем указанное время работы программы
            var durationSteps = Math.Min(40, runDuration);
            var durationStepDelay = runDuration / (double)durationSteps;

            for (int i = 0; i < durationSteps; i++)
            {
                cancellationToken.ThrowIfCancellationRequested();

                // Проверяем, не завершился ли процесс сам
                try
                {
                    if (process.HasExited)
                    {
                        task.Message = $"Программа завершилась самостоятельно (PID: {process.Id})";
                        task.Progress = 100;
                        await NotifyTaskUpdateAsync(task);
                        return;
                    }
                }
                catch (InvalidOperationException)
                {
                    // Процесс уже завершен
                    task.Message = $"Программа завершена";
                    task.Progress = 100;
                    await NotifyTaskUpdateAsync(task);
                    return;
                }

                task.Progress = 60 + (int)((i + 1) * 40.0 / durationSteps);
                var remaining = runDuration - (int)((i + 1) * durationStepDelay);
                task.Message = $"Программа работает... Закроется через: {remaining} секунд";
                await NotifyTaskUpdateAsync(task);

                await Task.Delay(TimeSpan.FromSeconds(durationStepDelay), cancellationToken);
            }

            // Закрываем программу
            task.Message = "Закрытие программы...";
            task.Progress = 95;
            await NotifyTaskUpdateAsync(task);

            try
            {
                if (!process.HasExited)
                {
                    process.CloseMainWindow(); // Пытаемся закрыть через главное окно (мягкое закрытие)
                    await Task.Delay(2000, cancellationToken); // Ждем 2 секунды

                    if (!process.HasExited)
                    {
                        process.Kill(); // Принудительное закрытие
                        await process.WaitForExitAsync(cancellationToken);
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Ошибка при закрытии процесса {ProcessId}", process?.Id);
            }

            task.Progress = 100;
            var processId = process?.Id ?? 0;
            task.Message = processId > 0 ? $"Программа закрыта (PID: {processId})" : "Программа закрыта";
            await NotifyTaskUpdateAsync(task);

            // Показываем уведомление о закрытии
            var fileName = Path.GetFileName(executablePath);
            ShowWindowsToastNotification(
                task.Name,
                $"Программа закрыта\n{fileName}"
            );
        }
        catch (Win32Exception win32Ex)
        {
            task.Status = Models.TaskStatus.Failed;
            var errorMsg = $"Ошибка запуска программы: {win32Ex.Message}";
            
            // Проверяем, нужны ли права администратора
            if (win32Ex.NativeErrorCode == 5 || // ERROR_ACCESS_DENIED
                win32Ex.Message.Contains("доступ", StringComparison.OrdinalIgnoreCase) ||
                win32Ex.Message.Contains("access denied", StringComparison.OrdinalIgnoreCase) ||
                win32Ex.Message.Contains("права", StringComparison.OrdinalIgnoreCase) ||
                win32Ex.Message.Contains("permission", StringComparison.OrdinalIgnoreCase))
            {
                errorMsg += "\n⚠️ ТРЕБУЮТСЯ ПРАВА АДМИНИСТРАТОРА!";
            }
            
            task.ErrorMessage = errorMsg;
            _logger.LogError(win32Ex, "Ошибка запуска программы в планировщике {TaskId}", task.Id);
            throw;
        }
        catch (Exception ex)
        {
            task.Status = Models.TaskStatus.Failed;
            task.ErrorMessage = $"Ошибка: {ex.Message}";
            _logger.LogError(ex, "Ошибка в планировщике {TaskId}", task.Id);
            throw;
        }
        finally
        {
            process?.Dispose();
        }
    }

    private async Task RunProcessTaskAsync(BackgroundTask task, Dictionary<string, string> parameters, CancellationToken cancellationToken)
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("Запуск процессов поддерживается только на Windows");
        }

        var executablePath = parameters.GetValueOrDefault("executablePath", string.Empty);
        var arguments = parameters.GetValueOrDefault("arguments", string.Empty);
        var workingDirectory = parameters.GetValueOrDefault("workingDirectory", string.Empty);

        if (string.IsNullOrWhiteSpace(executablePath))
        {
            throw new ArgumentException("Параметр 'executablePath' обязателен для запуска процесса");
        }

        // Очищаем путь: убираем кавычки и лишние пробелы
        var originalPath = executablePath;
        executablePath = executablePath.Trim().Trim('"', '\'');
        
        _logger.LogInformation("Попытка запуска процесса. Исходный путь: '{OriginalPath}', Очищенный путь: '{CleanedPath}'", 
            originalPath, executablePath);

        // Проверяем существование файла
        bool fileExists = false;
        string? resolvedPath = null;

        // Сначала проверяем прямой путь
        if (File.Exists(executablePath))
        {
            fileExists = true;
            resolvedPath = Path.GetFullPath(executablePath);
        }
        // Если файл не найден, проверяем в PATH
        else if (IsExecutableInPath(executablePath, out resolvedPath))
        {
            fileExists = true;
        }
        // Если путь относительный, пробуем найти в текущей директории
        else if (!Path.IsPathRooted(executablePath))
        {
            var currentDir = Directory.GetCurrentDirectory();
            var relativePath = Path.Combine(currentDir, executablePath);
            if (File.Exists(relativePath))
            {
                fileExists = true;
                resolvedPath = Path.GetFullPath(relativePath);
            }
        }

        if (!fileExists)
        {
            var errorDetails = $"Исполняемый файл не найден: {executablePath}";
            if (Directory.Exists(Path.GetDirectoryName(executablePath)))
            {
                errorDetails += $"\nДиректория существует, но файл '{Path.GetFileName(executablePath)}' не найден.";
            }
            else
            {
                errorDetails += $"\nДиректория не существует: {Path.GetDirectoryName(executablePath)}";
            }
            throw new FileNotFoundException(errorDetails);
        }

        // Используем разрешенный путь
        executablePath = resolvedPath ?? executablePath;

        task.Message = $"Запуск процесса: {executablePath}";
        await NotifyTaskUpdateAsync(task);

        var processStartInfo = new ProcessStartInfo
        {
            FileName = executablePath,
            Arguments = arguments,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        };

        if (!string.IsNullOrWhiteSpace(workingDirectory) && Directory.Exists(workingDirectory))
        {
            processStartInfo.WorkingDirectory = workingDirectory;
        }

        Process? process = null;
        try
        {
            process = new Process { StartInfo = processStartInfo };
            _runningProcesses[task.Id] = process;

            // Запускаем процесс
            process.Start();
            task.ProcessId = process.Id;
            task.Message = $"Процесс запущен (PID: {process.Id})";
            
            // Запускаем мониторинг метрик процесса
            _ = MonitorProcessMetricsAsync(task.Id, process, cancellationToken);
            
            await NotifyTaskUpdateAsync(task);

            // Асинхронно читаем вывод
            var outputTask = process.StandardOutput.ReadToEndAsync();
            var errorTask = process.StandardError.ReadToEndAsync();

            // Ждем завершения процесса или отмены
            var processTask = process.WaitForExitAsync(cancellationToken);
            
            try
            {
                await processTask;
            }
            catch (OperationCanceledException)
            {
                // Отмена запрошена, процесс будет завершен в StopTaskAsync
                throw;
            }

            // Ждем завершения чтения вывода
            await Task.WhenAll(outputTask, errorTask);

            var exitCode = process.ExitCode;
            var output = await outputTask;
            var error = await errorTask;

            if (exitCode == 0)
            {
                task.Message = $"Процесс завершен успешно (PID: {process.Id})";
                if (!string.IsNullOrWhiteSpace(output))
                {
                    task.Message += $"\nВывод: {output.Trim().Substring(0, Math.Min(200, output.Trim().Length))}";
                }
                
                // Показываем уведомление об успешном завершении
                ShowWindowsToastNotification(
                    task.Name,
                    $"Процесс завершен успешно\nPID: {process.Id}"
                );
            }
            else
            {
                task.Status = Models.TaskStatus.Failed;
                task.ErrorMessage = $"Процесс завершился с кодом {exitCode}";
                if (!string.IsNullOrWhiteSpace(error))
                {
                    task.ErrorMessage += $"\nОшибка: {error.Trim().Substring(0, Math.Min(200, error.Trim().Length))}";
                }
                
                // Показываем уведомление об ошибке
                ShowWindowsToastNotification(
                    task.Name,
                    $"Процесс завершился с ошибкой\nКод выхода: {exitCode}"
                );
            }
        }
        catch (OperationCanceledException)
        {
            task.Status = Models.TaskStatus.Cancelled;
            task.Message = "Процесс отменен";
            
            // Уведомление будет показано в StopTaskAsync
            throw;
        }
        catch (Exception ex)
        {
            task.Status = Models.TaskStatus.Failed;
            
            // Формируем более информативное сообщение об ошибке
            var errorMessage = $"Ошибка запуска процесса: {ex.Message}";
            
            if (ex is FileNotFoundException)
            {
                errorMessage = $"Файл не найден: {executablePath}\nПроверьте правильность пути к исполняемому файлу.";
            }
            else if (ex is UnauthorizedAccessException)
            {
                errorMessage = $"Нет доступа к файлу: {executablePath}\nВозможно, требуется запуск от имени администратора или файл защищен.";
            }
            else if (ex is Win32Exception win32Ex)
            {
                errorMessage = $"Ошибка Windows при запуске процесса: {win32Ex.Message}\nКод ошибки: {win32Ex.NativeErrorCode}";
            }
            else if (ex is ArgumentException)
            {
                errorMessage = $"Некорректные параметры: {ex.Message}";
            }
            
            task.ErrorMessage = errorMessage;
            _logger.LogError(ex, "Ошибка при запуске процесса {ExecutablePath}", executablePath);
            throw;
        }
        finally
        {
            if (process != null)
            {
                _runningProcesses.TryRemove(task.Id, out _);
                if (!process.HasExited)
                {
                    try
                    {
                        process.Kill();
                    }
                    catch { }
                }
                process.Dispose();
            }
        }
    }

    private bool IsExecutableInPath(string executable, out string? foundPath)
    {
        foundPath = null;
        try
        {
            var pathEnv = Environment.GetEnvironmentVariable("PATH");
            if (string.IsNullOrWhiteSpace(pathEnv))
                return false;

            var paths = pathEnv.Split(Path.PathSeparator);
            foreach (var path in paths)
            {
                var fullPath = Path.Combine(path, executable);
                if (File.Exists(fullPath))
                {
                    foundPath = Path.GetFullPath(fullPath);
                    return true;
                }
            }
        }
        catch { }
        return false;
    }

    private async Task NotifyTaskUpdateAsync(BackgroundTask task)
    {
        await _hubContext.Clients.All.SendAsync("TaskUpdated", task);
    }

    private async Task MonitorProcessMetricsAsync(string taskId, Process process, CancellationToken cancellationToken)
    {
        try
        {
            // Ждем немного, чтобы процесс успел запуститься
            await Task.Delay(500, cancellationToken);

            DateTime? lastUpdateTime = null;
            TimeSpan? lastCpuTime = null;

            while (!cancellationToken.IsCancellationRequested)
            {
                try
                {
                    // Проверяем, что процесс еще существует
                    bool processExists = false;
                    try
                    {
                        processExists = !process.HasExited;
                    }
                    catch (InvalidOperationException)
                    {
                        // Процесс уже завершен или не существует
                        break;
                    }

                    if (!processExists)
                    {
                        break; // Процесс завершен
                    }

                    if (_tasks.TryGetValue(taskId, out var task) && task.Status == Models.TaskStatus.Running)
                    {
                        try
                        {
                            process.Refresh();

                            // Вычисляем использование CPU
                            double cpuUsage = 0;
                            var currentTime = DateTime.UtcNow;
                            TimeSpan currentCpuTime;
                            
                            try
                            {
                                currentCpuTime = process.TotalProcessorTime;
                            }
                            catch (InvalidOperationException)
                            {
                                // Процесс завершен
                                break;
                            }

                            if (lastUpdateTime.HasValue && lastCpuTime.HasValue)
                            {
                                var timeDelta = (currentTime - lastUpdateTime.Value).TotalMilliseconds;
                                var cpuDelta = (currentCpuTime - lastCpuTime.Value).TotalMilliseconds;
                                
                                if (timeDelta > 0)
                                {
                                    // CPU usage = (CPU time used / Real time elapsed) * 100 / Number of cores
                                    cpuUsage = (cpuDelta / timeDelta) * 100.0 / Environment.ProcessorCount;
                                    cpuUsage = Math.Max(0, Math.Min(100, cpuUsage)); // Ограничиваем 0-100%
                                }
                            }

                            lastUpdateTime = currentTime;
                            lastCpuTime = currentCpuTime;

                            // Получаем использование памяти
                            long memoryUsage = 0;
                            try
                            {
                                memoryUsage = process.WorkingSet64; // Рабочий набор памяти в байтах
                            }
                            catch (InvalidOperationException)
                            {
                                // Процесс завершен
                                break;
                            }
                            catch { }

                            // Обновляем метрики в задаче
                            task.CpuUsage = Math.Round(cpuUsage, 2);
                            task.MemoryUsage = memoryUsage;
                            task.ProcessId = process.Id;

                            await NotifyTaskUpdateAsync(task);
                        }
                        catch (InvalidOperationException)
                        {
                            // Процесс завершен во время обновления
                            break;
                        }
                    }
                    else
                    {
                        break; // Задача завершена или отменена
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Ошибка при обновлении метрик процесса {TaskId}", taskId);
                    // Продолжаем попытки, если это не критическая ошибка
                }

                // Обновляем метрики каждые 2 секунды
                await Task.Delay(2000, cancellationToken);
            }
        }
        catch (OperationCanceledException)
        {
            // Нормальное завершение
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Ошибка в мониторинге процесса {TaskId}", taskId);
        }
    }

    private void ShowWindowsToastNotification(string title, string message)
    {
        try
        {
            // Проверяем, что мы на Windows
            if (!OperatingSystem.IsWindows())
            {
                _logger.LogWarning("Windows Toast уведомления поддерживаются только на Windows");
                return;
            }

            _logger.LogInformation("Попытка показать уведомление: {Title} - {Message}", title, message);

            // Пробуем использовать Windows Runtime API
            try
            {
                // Создаем XML для Toast уведомления
                var toastXml = ToastNotificationManager.GetTemplateContent(ToastTemplateType.ToastText02);
                
                // Устанавливаем текст
                var textNodes = toastXml.GetElementsByTagName("text");
                if (textNodes.Length >= 1)
                    textNodes[0].AppendChild(toastXml.CreateTextNode(title));
                if (textNodes.Length >= 2)
                    textNodes[1].AppendChild(toastXml.CreateTextNode(message));

                // Создаем и показываем уведомление
                var toast = new ToastNotification(toastXml);
                toast.ExpirationTime = DateTimeOffset.Now.AddMinutes(5);
                
                // Пробуем разные App ID
                var appId = "Microsoft.Windows.Shell.Runner"; // Стандартный App ID для консольных приложений
                var toastNotifier = ToastNotificationManager.CreateToastNotifier(appId);
                toastNotifier.Show(toast);
                
                _logger.LogInformation("Уведомление отправлено через Windows Runtime API");
                return;
            }
            catch (Exception winRtEx)
            {
                _logger.LogWarning(winRtEx, "Не удалось показать уведомление через Windows Runtime API, пробуем PowerShell");
            }

            // Альтернативный способ через PowerShell (более надежный)
            try
            {
                var psScript = $@"
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$textNodes = $template.GetElementsByTagName('text')
$textNodes.Item(0).AppendChild($template.CreateTextNode('{title.Replace("'", "''")}')) | Out-Null
$textNodes.Item(1).AppendChild($template.CreateTextNode('{message.Replace("'", "''").Replace("`n", " ")}')) | Out-Null

$toast = [Windows.UI.Notifications.ToastNotification]::new($template)
$toast.ExpirationTime = [DateTimeOffset]::Now.AddMinutes(5)
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Microsoft.Windows.Shell.Runner')
$notifier.Show($toast)
";

                var processStartInfo = new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = $"-NoProfile -ExecutionPolicy Bypass -Command \"{psScript.Replace("\"", "\\\"")}\"",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };

                using var psProcess = Process.Start(processStartInfo);
                if (psProcess != null)
                {
                    psProcess.WaitForExit(3000); // Ждем максимум 3 секунды
                    _logger.LogInformation("Уведомление отправлено через PowerShell");
                }
            }
            catch (Exception psEx)
            {
                _logger.LogError(psEx, "Не удалось показать уведомление через PowerShell");
            }
        }
        catch (Exception ex)
        {
            // Логируем ошибку, но не прерываем выполнение
            _logger.LogError(ex, "Не удалось показать Windows Toast уведомление: {Title} - {Message}", title, message);
        }
    }
}

