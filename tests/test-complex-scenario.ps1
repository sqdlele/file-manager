# Комплексный тест: множество очередей и множество фоновых процессов
# Демонстрирует реальный сценарий масштабирования

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$apiPort = "5270"
$apiUrl = "http://localhost:$apiPort/api"

Write-Host "Complex Scenario: Multiple Queues & Multiple Processes" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
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

# Конфигурация теста
$scenarios = @(
    @{
        Name = "Scenario 1: One queue, multiple workers"
        QueueName = "orders_queue"
        Workers = 3
        Messages = 15
        Description = "Load balancing: 3 workers processing orders"
    },
    @{
        Name = "Scenario 2: Multiple queues, one worker each"
        QueuePrefix = "notifications_"
        Queues = 5
        MessagesPerQueue = 4
        Description = "5 different notification types, each with its own processor"
    },
    @{
        Name = "Scenario 3: High volume queue"
        QueueName = "high_volume_queue"
        Workers = 4
        Messages = 30
        Description = "High throughput: 4 workers, 30 messages"
    }
)

$allCreatedTasks = @()
$totalMessagesSent = 0

# Сценарий 1: Одна очередь, несколько воркеров
Write-Host "2. $($scenarios[0].Name)" -ForegroundColor Yellow
Write-Host "   $($scenarios[0].Description)" -ForegroundColor Cyan
Write-Host ""

$queueName = $scenarios[0].QueueName
$workers = $scenarios[0].Workers
$messages = $scenarios[0].Messages

for ($i = 1; $i -le $workers; $i++) {
    $task = @{
        name = "Worker #$i for $queueName"
        type = "rabbitmq_consumer"
        parameters = @{
            queueName = $queueName
            maxMessages = ($messages + 5).ToString()
        }
    } | ConvertTo-Json -Depth 3
    
    try {
        $taskResult = Invoke-RestMethod -Uri "$apiUrl/tasks" `
            -Method Post -ContentType "application/json" -Body $task
        
        $allCreatedTasks += $taskResult.id
        Write-Host "   OK: Created Worker #$i" -ForegroundColor Green
        Start-Sleep -Milliseconds 200
    } catch {
        Write-Host "   ERROR: Failed to create Worker #$i" -ForegroundColor Red
    }
}

Start-Sleep -Seconds 1

Write-Host "   Sending $messages messages..." -ForegroundColor Cyan
for ($j = 1; $j -le $messages; $j++) {
    $msg = @{
        queueName = $queueName
        message = "Order #$j - $(Get-Date -Format 'HH:mm:ss.fff')"
    } | ConvertTo-Json
    
    try {
        Invoke-RestMethod -Uri "$apiUrl/rabbitmq/publish" `
            -Method Post -ContentType "application/json" -Body $msg | Out-Null
        $totalMessagesSent++
        Write-Host "     Message #$j sent" -ForegroundColor Gray
        Start-Sleep -Milliseconds 50
    } catch {
        Write-Host "     ERROR: Failed to send message #$j" -ForegroundColor Red
    }
}

Write-Host "   Completed: $queueName" -ForegroundColor Green
Write-Host ""

# Сценарий 2: Множество очередей, по одному воркеру на каждую
Write-Host "3. $($scenarios[1].Name)" -ForegroundColor Yellow
Write-Host "   $($scenarios[1].Description)" -ForegroundColor Cyan
Write-Host ""

$queuePrefix = $scenarios[1].QueuePrefix
$queues = $scenarios[1].Queues
$messagesPerQueue = $scenarios[1].MessagesPerQueue

for ($i = 1; $i -le $queues; $i++) {
    $queueName = "$queuePrefix$i"
    
    # Создаем воркер для очереди
    $task = @{
        name = "Processor for $queueName"
        type = "rabbitmq_consumer"
        parameters = @{
            queueName = $queueName
            maxMessages = ($messagesPerQueue + 2).ToString()
        }
    } | ConvertTo-Json -Depth 3
    
    try {
        $taskResult = Invoke-RestMethod -Uri "$apiUrl/tasks" `
            -Method Post -ContentType "application/json" -Body $task
        
        $allCreatedTasks += $taskResult.id
        Write-Host "   OK: Created processor for $queueName" -ForegroundColor Green
        
        # Отправляем сообщения в эту очередь
        for ($j = 1; $j -le $messagesPerQueue; $j++) {
            $msg = @{
                queueName = $queueName
                message = "Notification #$j for $queueName - $(Get-Date -Format 'HH:mm:ss.fff')"
            } | ConvertTo-Json
            
            try {
                Invoke-RestMethod -Uri "$apiUrl/rabbitmq/publish" `
                    -Method Post -ContentType "application/json" -Body $msg | Out-Null
                $totalMessagesSent++
                Write-Host "     Message #$j sent to $queueName" -ForegroundColor Gray
                Start-Sleep -Milliseconds 30
            } catch {
                Write-Host "     ERROR: Failed to send message" -ForegroundColor Red
            }
        }
        
        Start-Sleep -Milliseconds 200
    } catch {
        Write-Host "   ERROR: Failed to create processor for $queueName" -ForegroundColor Red
    }
}

Write-Host "   Completed: $queues queues with processors" -ForegroundColor Green
Write-Host ""

# Сценарий 3: Высокая нагрузка
Write-Host "4. $($scenarios[2].Name)" -ForegroundColor Yellow
Write-Host "   $($scenarios[2].Description)" -ForegroundColor Cyan
Write-Host ""

$queueName = $scenarios[2].QueueName
$workers = $scenarios[2].Workers
$messages = $scenarios[2].Messages

for ($i = 1; $i -le $workers; $i++) {
    $task = @{
        name = "High-Volume Worker #$i"
        type = "rabbitmq_consumer"
        parameters = @{
            queueName = $queueName
            maxMessages = ($messages + 10).ToString()
        }
    } | ConvertTo-Json -Depth 3
    
    try {
        $taskResult = Invoke-RestMethod -Uri "$apiUrl/tasks" `
            -Method Post -ContentType "application/json" -Body $task
        
        $allCreatedTasks += $taskResult.id
        Write-Host "   OK: Created High-Volume Worker #$i" -ForegroundColor Green
        Start-Sleep -Milliseconds 150
    } catch {
        Write-Host "   ERROR: Failed to create Worker #$i" -ForegroundColor Red
    }
}

Start-Sleep -Seconds 1

Write-Host "   Sending $messages messages rapidly..." -ForegroundColor Cyan
for ($j = 1; $j -le $messages; $j++) {
    $msg = @{
        queueName = $queueName
        message = "High-Volume Message #$j - $(Get-Date -Format 'HH:mm:ss.fff')"
    } | ConvertTo-Json
    
    try {
        Invoke-RestMethod -Uri "$apiUrl/rabbitmq/publish" `
            -Method Post -ContentType "application/json" -Body $msg | Out-Null
        $totalMessagesSent++
        if ($j % 5 -eq 0) {
            Write-Host "     Sent $j messages..." -ForegroundColor Gray
        }
        Start-Sleep -Milliseconds 20
    } catch {
        Write-Host "     ERROR: Failed to send message #$j" -ForegroundColor Red
    }
}

Write-Host "   Completed: $queueName" -ForegroundColor Green
Write-Host ""

# Итоговая статистика
Write-Host "5. Final Statistics" -ForegroundColor Yellow
Write-Host "   =================" -ForegroundColor Yellow
Start-Sleep -Seconds 3

try {
    $allTasks = Invoke-RestMethod -Uri "$apiUrl/tasks" -Method Get
    $listenerTasks = $allTasks | Where-Object { $_.type -eq 'rabbitmq_consumer' }
    
    Write-Host ""
    Write-Host "   Total background processes created: $($listenerTasks.Count)" -ForegroundColor White
    Write-Host "   Total messages sent: $totalMessagesSent" -ForegroundColor White
    Write-Host ""
    
    $totalProcessed = 0
    $runningCount = 0
    $pausedCount = 0
    $completedCount = 0
    
    foreach ($task in $listenerTasks) {
        $progress = if ($task.progress) { [int]$task.progress } else { 0 }
        $totalProcessed += $progress
        
        $status = $task.status
        if ($status -eq 1 -or $status -eq 'Running' -or $status -eq '1') {
            $runningCount++
        } elseif ($status -eq 2 -or $status -eq 'Paused' -or $status -eq '2') {
            $pausedCount++
        } elseif ($status -eq 3 -or $status -eq 'Completed' -or $status -eq '3') {
            $completedCount++
        }
    }
    
    Write-Host "   Processes status:" -ForegroundColor Cyan
    Write-Host "     - Running: $runningCount" -ForegroundColor Green
    Write-Host "     - Paused: $pausedCount" -ForegroundColor Yellow
    Write-Host "     - Completed: $completedCount" -ForegroundColor Gray
    Write-Host ""
    Write-Host "   Total messages processed: $totalProcessed" -ForegroundColor Cyan
    Write-Host ""
    
    if ($totalProcessed -ge $totalMessagesSent) {
        Write-Host "   Status: All messages processed successfully!" -ForegroundColor Green
    } else {
        Write-Host "   Status: Processing in progress ($totalProcessed / $totalMessagesSent)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "   ERROR: Failed to get statistics" -ForegroundColor Red
}

Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "Complex scenario testing completed!" -ForegroundColor Green
Write-Host ""
Write-Host "What this demonstrates:" -ForegroundColor Yellow
Write-Host "   - Multiple queues with dedicated processors" -ForegroundColor White
Write-Host "   - Load balancing with multiple workers per queue" -ForegroundColor White
Write-Host "   - Horizontal scaling capabilities" -ForegroundColor White
Write-Host "   - Parallel processing of different message types" -ForegroundColor White
Write-Host ""
Write-Host "Check results:" -ForegroundColor Yellow
Write-Host "   1. Web interface: http://localhost:$apiPort" -ForegroundColor White
Write-Host "   2. Tasks tab: Should show all $($allCreatedTasks.Count) background processes" -ForegroundColor White
Write-Host "   3. Notifications tab: Should have $totalMessagesSent notifications" -ForegroundColor White
Write-Host "   4. RabbitMQ Management: http://localhost:15672" -ForegroundColor White
Write-Host "   5. Queues tab: Should show all created queues" -ForegroundColor White
Write-Host ""

