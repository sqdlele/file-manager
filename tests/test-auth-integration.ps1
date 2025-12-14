# Тест интеграции AuthApp с TasksManager
# Проверяет отправку и получение сообщений о регистрации

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$tasksManagerPort = "5270"
$authAppPort = "5300"
$tasksApiUrl = "http://localhost:$tasksManagerPort/api"

Write-Host "Testing AuthApp Integration" -ForegroundColor Cyan
Write-Host "===========================" -ForegroundColor Cyan
Write-Host ""

# Шаг 1: Создаем задачу для прослушивания очереди user_registrations
Write-Host "1. Creating task to listen to 'user_registrations' queue..." -ForegroundColor Yellow

$task = @{
    name = "Listen User Registrations"
    type = "rabbitmq_consumer"
    parameters = @{
        queueName = "user_registrations"
        maxMessages = "100"
    }
} | ConvertTo-Json -Depth 3

try {
    $taskResult = Invoke-RestMethod -Uri "$tasksApiUrl/tasks" `
        -Method Post `
        -ContentType "application/json" `
        -Body $task
    
    Write-Host "   OK: Task created: $($taskResult.id)" -ForegroundColor Green
    Write-Host "   Status: $($taskResult.status)" -ForegroundColor Cyan
    Start-Sleep -Seconds 2
} catch {
    $errorMsg = $_.Exception.Message
    Write-Host "   ERROR: Failed to create task: $errorMsg" -ForegroundColor Red
    Write-Host ""
    Write-Host "   Make sure TasksManager backend is running on port $tasksManagerPort" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "2. Now register a user in AuthApp:" -ForegroundColor Yellow
Write-Host "   - Open: http://localhost:$authAppPort" -ForegroundColor White
Write-Host "   - Fill registration form" -ForegroundColor White
Write-Host "   - Click 'Зарегистрироваться'" -ForegroundColor White
Write-Host ""
Write-Host "   Or use API directly:" -ForegroundColor Cyan
Write-Host "   POST http://localhost:$authAppPort/api/auth/register" -ForegroundColor Gray
Write-Host ""

$register = Read-Host "Do you want to test registration via API now? (y/n)"

if ($register -eq 'y' -or $register -eq 'Y') {
    Write-Host ""
    Write-Host "3. Registering test user..." -ForegroundColor Yellow
    
    $registerData = @{
        username = "testuser_$(Get-Date -Format 'HHmmss')"
        email = "test_$(Get-Date -Format 'HHmmss')@example.com"
        password = "test123"
    } | ConvertTo-Json
    
    try {
        $registerResponse = Invoke-RestMethod -Uri "http://localhost:$authAppPort/api/auth/register" `
            -Method Post `
            -ContentType "application/json" `
            -Body $registerData
        
        Write-Host "   OK: User registered: $($registerResponse.user.username)" -ForegroundColor Green
        Write-Host "   Message: $($registerResponse.message)" -ForegroundColor Cyan
        Start-Sleep -Seconds 2
    } catch {
        $errorMsg = $_.Exception.Message
        Write-Host "   ERROR: Failed to register user: $errorMsg" -ForegroundColor Red
        Write-Host ""
        Write-Host "   Make sure AuthApp is running on port $authAppPort" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "4. Checking task status..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

try {
    $allTasks = Invoke-RestMethod -Uri "$tasksApiUrl/tasks" -Method Get
    $listenerTask = $allTasks | Where-Object { 
        $_.type -eq 'rabbitmq_consumer' -and 
        $_.name -like "*user_registrations*" 
    } | Select-Object -First 1
    
    if ($listenerTask) {
        Write-Host ""
        Write-Host "   Task Status: $($listenerTask.status)" -ForegroundColor Cyan
        Write-Host "   Progress: $($listenerTask.progress)" -ForegroundColor Cyan
        Write-Host "   Message: $($listenerTask.message)" -ForegroundColor Cyan
        
        if ($listenerTask.progress -gt 0) {
            Write-Host ""
            Write-Host "   SUCCESS: Messages received!" -ForegroundColor Green
        } else {
            Write-Host ""
            Write-Host "   Waiting for messages..." -ForegroundColor Yellow
            Write-Host "   Check RabbitMQ Management: http://localhost:15672" -ForegroundColor White
            Write-Host "   Go to Queues -> user_registrations" -ForegroundColor White
        }
    } else {
        Write-Host "   ERROR: Listener task not found" -ForegroundColor Red
    }
} catch {
    Write-Host "   ERROR: Failed to check task status" -ForegroundColor Red
}

Write-Host ""
Write-Host "===========================" -ForegroundColor Cyan
Write-Host "Check:" -ForegroundColor Yellow
Write-Host "   1. TasksManager: http://localhost:$tasksManagerPort" -ForegroundColor White
Write-Host "   2. Notifications tab - should show registration notifications" -ForegroundColor White
Write-Host "   3. RabbitMQ Management: http://localhost:15672" -ForegroundColor White
Write-Host "   4. Queues -> user_registrations - check messages" -ForegroundColor White
Write-Host ""

