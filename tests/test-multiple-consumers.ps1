# Тест множественных фоновых процессов, слушающих разные очереди
# Создает множество задач-слушателей и отправляет сообщения в разные очереди

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$apiPort = "5270"
$apiUrl = "http://localhost:$apiPort/api"

Write-Host "Testing Multiple Background Processes" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# Проверка подключения
Write-Host "1. Checking API connection..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$apiUrl/tasks" -Method Get -ErrorAction Stop
    Write-Host "   OK: API is available" -ForegroundColor Green
} catch {
    Write-Host "   ERROR: API is not available. Make sure the application is running." -ForegroundColor Red
    exit 1
}

Write-Host ""

# Количество очередей и процессов
$numberOfQueues = 10
$messagesPerQueue = 5

Write-Host "2. Creating $numberOfQueues background processes (listeners)..." -ForegroundColor Yellow
Write-Host "   Each process will listen to its own queue" -ForegroundColor Cyan
Write-Host ""

$createdTasks = @()

for ($i = 1; $i -le $numberOfQueues; $i++) {
    $queueName = "queue_$i"
    $taskName = "Listener for Queue $i"
    
    $task = @{
        name = $taskName
        type = "rabbitmq_consumer"
        parameters = @{
            queueName = $queueName
            maxMessages = ($messagesPerQueue * 2).ToString()  # Больше, чем отправим
        }
    } | ConvertTo-Json -Depth 3
    
    try {
        $taskResult = Invoke-RestMethod -Uri "$apiUrl/tasks" `
            -Method Post `
            -ContentType "application/json" `
            -Body $task
        
        $createdTasks += @{
            TaskId = $taskResult.id
            QueueName = $queueName
            TaskName = $taskName
        }
        
        Write-Host "   OK: Created listener #$i for queue '$queueName' (Task ID: $($taskResult.id))" -ForegroundColor Green
        Start-Sleep -Milliseconds 200
    } catch {
        $errorMsg = $_.Exception.Message
        Write-Host "   ERROR: Failed to create listener #${i}: $errorMsg" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "   Total listeners created: $($createdTasks.Count)" -ForegroundColor Cyan
Start-Sleep -Seconds 2

# Отправка сообщений в каждую очередь
Write-Host ""
Write-Host "3. Sending $messagesPerQueue messages to each queue..." -ForegroundColor Yellow
Write-Host ""

$totalMessages = 0

foreach ($taskInfo in $createdTasks) {
    $queueName = $taskInfo.QueueName
    Write-Host "   Sending messages to '$queueName'..." -ForegroundColor Cyan
    
    for ($j = 1; $j -le $messagesPerQueue; $j++) {
        $message = @{
            queueName = $queueName
            message = "Message #$j for $queueName - $(Get-Date -Format 'HH:mm:ss.fff')"
        } | ConvertTo-Json
        
        try {
            $result = Invoke-RestMethod -Uri "$apiUrl/rabbitmq/publish" `
                -Method Post `
                -ContentType "application/json" `
                -Body $message | Out-Null
            
            $totalMessages++
            Write-Host "     OK: Message #$j sent" -ForegroundColor Gray
            Start-Sleep -Milliseconds 50
        } catch {
            Write-Host "     ERROR: Failed to send message #$j" -ForegroundColor Red
        }
    }
    
    Write-Host "   Completed: $queueName ($messagesPerQueue messages)" -ForegroundColor Green
    Write-Host ""
    Start-Sleep -Milliseconds 300
}

Write-Host ""
Write-Host "4. Summary" -ForegroundColor Yellow
Write-Host "   ======" -ForegroundColor Yellow
Write-Host "   Queues created: $numberOfQueues" -ForegroundColor White
Write-Host "   Listeners created: $($createdTasks.Count)" -ForegroundColor White
Write-Host "   Messages sent per queue: $messagesPerQueue" -ForegroundColor White
Write-Host "   Total messages sent: $totalMessages" -ForegroundColor White
Write-Host ""

# Проверка статуса задач
Write-Host "5. Checking task statuses..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

try {
    $allTasks = Invoke-RestMethod -Uri "$apiUrl/tasks" -Method Get
    
    $listenerTasks = $allTasks | Where-Object { $_.type -eq 'rabbitmq_consumer' }
    
    Write-Host ""
    Write-Host "   Active listeners:" -ForegroundColor Cyan
    foreach ($task in $listenerTasks) {
        $status = $task.status
        $progress = if ($task.progress) { " (Progress: $($task.progress))" } else { "" }
        Write-Host "     - $($task.name): $status$progress" -ForegroundColor White
    }
} catch {
    Write-Host "   ERROR: Failed to check task statuses" -ForegroundColor Red
}

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "Testing completed!" -ForegroundColor Green
Write-Host ""
Write-Host "What to check:" -ForegroundColor Yellow
Write-Host "   1. Open web interface: http://localhost:$apiPort" -ForegroundColor White
Write-Host "   2. Check 'Tasks' tab - you should see $numberOfQueues listener tasks" -ForegroundColor White
Write-Host "   3. Check 'Notifications' tab - should have $totalMessages notifications" -ForegroundColor White
Write-Host "   4. Open RabbitMQ Management: http://localhost:15672" -ForegroundColor White
Write-Host "   5. Go to 'Queues and Streams' - should see $numberOfQueues queues" -ForegroundColor White
Write-Host "   6. Each queue should show processed messages" -ForegroundColor White
Write-Host ""
Write-Host "Note: All listeners are running in parallel and processing messages independently" -ForegroundColor Cyan
Write-Host ""

