# Скрипт для быстрого тестирования RabbitMQ
# Использование: .\test-rabbitmq.ps1

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# Порт приложения (можно изменить при необходимости)
$apiPort = "5270"
$apiUrl = "http://localhost:$apiPort/api"

Write-Host "Testing RabbitMQ" -ForegroundColor Cyan
Write-Host "================" -ForegroundColor Cyan
Write-Host ""

# Проверка подключения к API
Write-Host "1. Checking API connection..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$apiUrl/tasks" -Method Get -ErrorAction Stop
    Write-Host "   OK: API is available" -ForegroundColor Green
} catch {
    Write-Host "   ERROR: API is not available. Make sure the application is running." -ForegroundColor Red
    exit 1
}

Write-Host ""

# Тест 1: Отправка сообщения в очередь test_queue
Write-Host "2. Sending test message to queue 'test_queue'..." -ForegroundColor Yellow
$message1 = @{
    queueName = "test_queue"
    message = "Test message #1 at $(Get-Date -Format 'HH:mm:ss')"
} | ConvertTo-Json

try {
    $result = Invoke-RestMethod -Uri "$apiUrl/rabbitmq/publish" `
        -Method Post `
        -ContentType "application/json" `
        -Body $message1
    
    Write-Host "   OK: Message sent: $($result.messageContent)" -ForegroundColor Green
} catch {
    Write-Host "   ERROR: Failed to send message: $_" -ForegroundColor Red
}

Start-Sleep -Seconds 2

# Тест 2: Отправка нескольких сообщений
Write-Host ""
Write-Host "3. Sending 5 messages to queue 'test_queue'..." -ForegroundColor Yellow
for ($i = 1; $i -le 5; $i++) {
    $message = @{
        queueName = "test_queue"
        message = "Message #$i - $(Get-Date -Format 'HH:mm:ss')"
    } | ConvertTo-Json
    
    try {
        $result = Invoke-RestMethod -Uri "$apiUrl/rabbitmq/publish" `
            -Method Post `
            -ContentType "application/json" `
            -Body $message
        
        Write-Host "   OK: Message #$i sent" -ForegroundColor Green
        Start-Sleep -Milliseconds 500
    } catch {
        Write-Host "   ERROR: Failed to send message #$i" -ForegroundColor Red
    }
}

# Тест 3: Создание задачи для отправки сообщений
Write-Host ""
Write-Host "4. Creating task to send messages..." -ForegroundColor Yellow
$task1 = @{
    name = "Test: Send to RabbitMQ"
    type = "rabbitmq"
    parameters = @{
        queueName = "test_task_queue"
        message = "Message from task"
        interval = "2"
        count = "5"
    }
} | ConvertTo-Json -Depth 3

try {
    $taskResult = Invoke-RestMethod -Uri "$apiUrl/tasks" `
        -Method Post `
        -ContentType "application/json" `
        -Body $task1
    
    Write-Host "   OK: Task created: $($taskResult.id)" -ForegroundColor Green
    Write-Host "   Status: $($taskResult.status)" -ForegroundColor Cyan
} catch {
    Write-Host "   ERROR: Failed to create task: $_" -ForegroundColor Red
}

Start-Sleep -Seconds 3

# Тест 4: Создание задачи для прослушивания очереди
Write-Host ""
Write-Host "5. Creating task to listen to queue..." -ForegroundColor Yellow
$task2 = @{
    name = "Test: Listen RabbitMQ Queue"
    type = "rabbitmq_consumer"
    parameters = @{
        queueName = "test_listener_queue"
        maxMessages = "10"
    }
} | ConvertTo-Json -Depth 3

try {
    $taskResult2 = Invoke-RestMethod -Uri "$apiUrl/tasks" `
        -Method Post `
        -ContentType "application/json" `
        -Body $task2
    
    Write-Host "   OK: Listener task created: $($taskResult2.id)" -ForegroundColor Green
    Write-Host "   Status: $($taskResult2.status)" -ForegroundColor Cyan
    
    # Отправляем сообщения в очередь, которую слушает задача
    Write-Host ""
    Write-Host "   Sending messages to queue 'test_listener_queue'..." -ForegroundColor Yellow
    Start-Sleep -Seconds 2
    
    for ($i = 1; $i -le 3; $i++) {
        $msg = @{
            queueName = "test_listener_queue"
            message = "Message for listener #$i"
        } | ConvertTo-Json
        
        try {
            Invoke-RestMethod -Uri "$apiUrl/rabbitmq/publish" `
                -Method Post `
                -ContentType "application/json" `
                -Body $msg | Out-Null
            Write-Host "   OK: Message #$i sent to queue" -ForegroundColor Green
            Start-Sleep -Seconds 1
        } catch {
            Write-Host "   ERROR: Failed to send message #$i" -ForegroundColor Red
        }
    }
} catch {
    Write-Host "   ERROR: Failed to create listener task: $_" -ForegroundColor Red
}

# Итоги
Write-Host ""
Write-Host "================" -ForegroundColor Cyan
Write-Host "Testing completed!" -ForegroundColor Green
Write-Host ""
Write-Host "What to check:" -ForegroundColor Yellow
Write-Host "   1. Open web interface: http://localhost:$apiPort" -ForegroundColor White
Write-Host "   2. Check 'Notifications' tab - notifications should appear" -ForegroundColor White
Write-Host "   3. Check tasks table - new tasks should be created" -ForegroundColor White
Write-Host "   4. Open RabbitMQ Management: http://localhost:15672" -ForegroundColor White
Write-Host "   5. Go to Queues - new queues should be created" -ForegroundColor White
Write-Host ""
