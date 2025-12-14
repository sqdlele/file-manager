# Тест конкурентной обработки: несколько процессов слушают одну очередь
# Это демонстрирует распределение нагрузки между воркерами

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$apiPort = "5270"
$apiUrl = "http://localhost:$apiPort/api"

Write-Host "Testing Concurrent Consumers (Load Balancing)" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
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

# Параметры теста
$sharedQueueName = "shared_work_queue"
$numberOfWorkers = 5  # Количество воркеров для одной очереди
$totalMessages = 20   # Всего сообщений для обработки

Write-Host "2. Creating $numberOfWorkers workers for queue '$sharedQueueName'..." -ForegroundColor Yellow
Write-Host "   All workers will listen to the same queue (load balancing)" -ForegroundColor Cyan
Write-Host ""

$createdWorkers = @()

for ($i = 1; $i -le $numberOfWorkers; $i++) {
    $taskName = "Worker #$i for $sharedQueueName"
    
    $task = @{
        name = $taskName
        type = "rabbitmq_consumer"
        parameters = @{
            queueName = $sharedQueueName
            maxMessages = ($totalMessages + 10).ToString()  # Больше, чем отправим
        }
    } | ConvertTo-Json -Depth 3
    
    try {
        $taskResult = Invoke-RestMethod -Uri "$apiUrl/tasks" `
            -Method Post `
            -ContentType "application/json" `
            -Body $task
        
        $createdWorkers += @{
            TaskId = $taskResult.id
            WorkerNumber = $i
            TaskName = $taskName
        }
        
        Write-Host "   OK: Created Worker #$i (Task ID: $($taskResult.id))" -ForegroundColor Green
        Start-Sleep -Milliseconds 300
    } catch {
        $errorMsg = $_.Exception.Message
        Write-Host "   ERROR: Failed to create Worker #${i}: $errorMsg" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "   Total workers created: $($createdWorkers.Count)" -ForegroundColor Cyan
Start-Sleep -Seconds 2

# Отправка сообщений в общую очередь
Write-Host ""
Write-Host "3. Sending $totalMessages messages to shared queue '$sharedQueueName'..." -ForegroundColor Yellow
Write-Host "   Messages will be distributed among $numberOfWorkers workers" -ForegroundColor Cyan
Write-Host ""

for ($j = 1; $j -le $totalMessages; $j++) {
    $message = @{
        queueName = $sharedQueueName
        message = "Message #$j - Worker will process this - $(Get-Date -Format 'HH:mm:ss.fff')"
    } | ConvertTo-Json
    
    try {
        $result = Invoke-RestMethod -Uri "$apiUrl/rabbitmq/publish" `
            -Method Post `
            -ContentType "application/json" `
            -Body $message | Out-Null
        
        Write-Host "   OK: Message #$j sent" -ForegroundColor Gray
        Start-Sleep -Milliseconds 100
    } catch {
        Write-Host "   ERROR: Failed to send message #$j" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "   All $totalMessages messages sent" -ForegroundColor Green
Start-Sleep -Seconds 3

# Проверка статуса воркеров
Write-Host ""
Write-Host "4. Checking worker statuses..." -ForegroundColor Yellow

try {
    $allTasks = Invoke-RestMethod -Uri "$apiUrl/tasks" -Method Get
    
    $workerTasks = $allTasks | Where-Object { 
        $_.type -eq 'rabbitmq_consumer' -and 
        $_.name -like "*$sharedQueueName*" 
    }
    
    Write-Host ""
    Write-Host "   Worker statuses:" -ForegroundColor Cyan
    $totalProcessed = 0
    foreach ($task in $workerTasks) {
        $progress = if ($task.progress) { $task.progress } else { 0 }
        $totalProcessed += $progress
        Write-Host "     - $($task.name): $($task.status) (Processed: $progress messages)" -ForegroundColor White
    }
    
    Write-Host ""
    Write-Host "   Total messages processed by all workers: $totalProcessed" -ForegroundColor Cyan
    Write-Host "   Total messages sent: $totalMessages" -ForegroundColor Cyan
    
    if ($totalProcessed -ge $totalMessages) {
        Write-Host "   Status: All messages processed!" -ForegroundColor Green
    } else {
        Write-Host "   Status: Processing in progress..." -ForegroundColor Yellow
    }
} catch {
    Write-Host "   ERROR: Failed to check worker statuses" -ForegroundColor Red
}

Write-Host ""
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "Testing completed!" -ForegroundColor Green
Write-Host ""
Write-Host "What this demonstrates:" -ForegroundColor Yellow
Write-Host "   - Multiple workers can listen to the same queue" -ForegroundColor White
Write-Host "   - RabbitMQ distributes messages among workers (round-robin)" -ForegroundColor White
Write-Host "   - This enables horizontal scaling and load balancing" -ForegroundColor White
Write-Host ""
Write-Host "Check:" -ForegroundColor Yellow
Write-Host "   1. Web interface: http://localhost:$apiPort" -ForegroundColor White
Write-Host "   2. RabbitMQ Management: http://localhost:15672 -> Queues -> $sharedQueueName" -ForegroundColor White
Write-Host "   3. Each worker should have processed some messages" -ForegroundColor White
Write-Host ""

