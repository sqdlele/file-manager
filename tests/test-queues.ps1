# Скрипт для проверки очередей в RabbitMQ
# Отправляет сообщения в разные очереди для проверки

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$apiPort = "5270"
$apiUrl = "http://localhost:$apiPort/api"

Write-Host "Testing RabbitMQ Queues" -ForegroundColor Cyan
Write-Host "======================" -ForegroundColor Cyan
Write-Host ""

# Очередь, которая слушается автоматически (сообщения будут сразу потребляться)
Write-Host "1. Sending message to 'test_queue' (auto-consumed)..." -ForegroundColor Yellow
$msg1 = @{
    queueName = "test_queue"
    message = "Message to auto-consumed queue - will be processed immediately"
} | ConvertTo-Json

try {
    $result = Invoke-RestMethod -Uri "$apiUrl/rabbitmq/publish" `
        -Method Post -ContentType "application/json" -Body $msg1
    Write-Host "   OK: Message sent (will be consumed immediately)" -ForegroundColor Green
} catch {
    Write-Host "   ERROR: $_" -ForegroundColor Red
}

Start-Sleep -Seconds 2

# Очередь, которая НЕ слушается автоматически (сообщения останутся в очереди)
Write-Host ""
Write-Host "2. Sending messages to 'manual_test_queue' (NOT auto-consumed)..." -ForegroundColor Yellow
Write-Host "   These messages will REMAIN in the queue for you to see in RabbitMQ Management" -ForegroundColor Cyan

for ($i = 1; $i -le 5; $i++) {
    $msg = @{
        queueName = "manual_test_queue"
        message = "Message #$i - This will stay in queue - $(Get-Date -Format 'HH:mm:ss')"
    } | ConvertTo-Json
    
    try {
        $result = Invoke-RestMethod -Uri "$apiUrl/rabbitmq/publish" `
            -Method Post -ContentType "application/json" -Body $msg
        Write-Host "   OK: Message #$i sent to manual_test_queue" -ForegroundColor Green
        Start-Sleep -Milliseconds 300
    } catch {
        Write-Host "   ERROR: Failed to send message #$i" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "======================" -ForegroundColor Cyan
Write-Host "Check RabbitMQ Management:" -ForegroundColor Yellow
Write-Host "   1. Open: http://localhost:15672" -ForegroundColor White
Write-Host "   2. Go to 'Queues and Streams' tab" -ForegroundColor White
Write-Host "   3. Look for queue: 'manual_test_queue'" -ForegroundColor White
Write-Host "   4. Click on it to see messages" -ForegroundColor White
Write-Host "   5. You should see 5 messages in 'Ready' state" -ForegroundColor White
Write-Host ""
Write-Host "Note: 'test_queue' may be empty because messages are auto-consumed" -ForegroundColor Cyan
Write-Host ""

