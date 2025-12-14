# Проверка, слушает ли какая-то задача очередь user_registrations

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$apiPort = "5270"
$apiUrl = "http://localhost:$apiPort/api"

Write-Host "Checking Queue Listeners" -ForegroundColor Cyan
Write-Host "========================" -ForegroundColor Cyan
Write-Host ""

try {
    $allTasks = Invoke-RestMethod -Uri "$apiUrl/tasks" -Method Get
    
    Write-Host "All tasks:" -ForegroundColor Yellow
    foreach ($task in $allTasks) {
        Write-Host "  - $($task.name) (Type: $($task.type), Status: $($task.status))" -ForegroundColor White
    }
    
    Write-Host ""
    Write-Host "Tasks listening to 'user_registrations':" -ForegroundColor Yellow
    
    $listeners = $allTasks | Where-Object { 
        $_.type -eq 'rabbitmq_consumer'
    }
    
    if ($listeners.Count -eq 0) {
        Write-Host "  ERROR: No listener tasks found!" -ForegroundColor Red
        Write-Host ""
        Write-Host "  Solution: Create a task to listen to 'user_registrations' queue" -ForegroundColor Yellow
        Write-Host "  1. Open http://localhost:$apiPort" -ForegroundColor White
        Write-Host "  2. Click 'Create Task'" -ForegroundColor White
        Write-Host "  3. Type: 'Listen RabbitMQ Queue'" -ForegroundColor White
        Write-Host "  4. Queue name: 'user_registrations'" -ForegroundColor White
    } else {
        $found = $false
        foreach ($listener in $listeners) {
            # Проверяем параметры задачи
            $queueName = "unknown"
            if ($listener.parameters -and $listener.parameters.queueName) {
                $queueName = $listener.parameters.queueName
            }
            Write-Host "  - $($listener.name)" -ForegroundColor Cyan
            Write-Host "    Queue: $queueName" -ForegroundColor Gray
            Write-Host "    Status: $($listener.status)" -ForegroundColor Gray
            Write-Host "    Progress: $($listener.progress)" -ForegroundColor Gray
            
            if ($queueName -eq "user_registrations") {
                $found = true
                if ($listener.status -eq 1 -or $listener.status -eq "Running") {
                    Write-Host "    Status: ACTIVE - Should receive messages" -ForegroundColor Green
                } else {
                    Write-Host "    Status: NOT RUNNING - Task is not active" -ForegroundColor Red
                }
            }
        }
        
        if (-not $found) {
            Write-Host ""
            Write-Host "  WARNING: No task is listening to 'user_registrations' queue!" -ForegroundColor Red
            Write-Host "  Create a new task with queue name: 'user_registrations'" -ForegroundColor Yellow
        }
    }
    
    Write-Host ""
    Write-Host "RabbitMQ Queue Status:" -ForegroundColor Yellow
    Write-Host "  Queue: user_registrations" -ForegroundColor White
    Write-Host "  Ready: 1 (message waiting to be processed)" -ForegroundColor Yellow
    Write-Host "  This means: Message is in queue but no active listener" -ForegroundColor Yellow
    
} catch {
    Write-Host "ERROR: Failed to check tasks: ${_}" -ForegroundColor Red
}

Write-Host ""

