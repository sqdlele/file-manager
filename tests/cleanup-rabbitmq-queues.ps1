# Скрипт для очистки очередей RabbitMQ
# Удаляет все очереди, которые были созданы тестами

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$apiPort = "5270"
$apiUrl = "http://localhost:$apiPort/api"

Write-Host "RabbitMQ Queue Cleanup" -ForegroundColor Cyan
Write-Host "=====================" -ForegroundColor Cyan
Write-Host ""
Write-Host "This script will help you delete queues from RabbitMQ." -ForegroundColor Yellow
Write-Host "Note: Queues are persistent and don't delete automatically." -ForegroundColor Yellow
Write-Host ""

# Список очередей для удаления (можно изменить)
$queuesToDelete = @(
    "test_queue",
    "test_manual_check",
    "test_task_queue",
    "test_listener_queue",
    "manual_test_queue",
    "shared_work_queue",
    "orders_queue",
    "high_volume_queue"
)

# Добавляем очереди из тестов (queue_1, queue_2, ..., queue_10, notifications_1, ..., notifications_5)
for ($i = 1; $i -le 10; $i++) {
    $queuesToDelete += "queue_$i"
}

for ($i = 1; $i -le 5; $i++) {
    $queuesToDelete += "notifications_$i"
}

Write-Host "Queues to delete:" -ForegroundColor Yellow
foreach ($queue in $queuesToDelete) {
    Write-Host "  - $queue" -ForegroundColor White
}

Write-Host ""
$confirm = Read-Host "Do you want to delete these queues? (y/n)"

if ($confirm -ne 'y' -and $confirm -ne 'Y') {
    Write-Host "Cancelled." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "To delete queues, you have two options:" -ForegroundColor Cyan
Write-Host ""
Write-Host "Option 1: Manual deletion via RabbitMQ Management UI" -ForegroundColor Yellow
Write-Host "  1. Open http://localhost:15672" -ForegroundColor White
Write-Host "  2. Go to 'Queues and Streams'" -ForegroundColor White
Write-Host "  3. Click on each queue" -ForegroundColor White
Write-Host "  4. Click 'Delete' button at the bottom" -ForegroundColor White
Write-Host "  5. Confirm deletion" -ForegroundColor White
Write-Host ""
Write-Host "Option 2: Use RabbitMQ Management API (requires authentication)" -ForegroundColor Yellow
Write-Host "  You can use curl or PowerShell to delete queues via API" -ForegroundColor White
Write-Host ""
Write-Host "Example curl command:" -ForegroundColor Cyan
Write-Host "  curl -u guest:guest -X DELETE http://localhost:15672/api/queues/%2F/queue_name" -ForegroundColor Gray
Write-Host ""
Write-Host "Note: %2F is URL-encoded '/' (default virtual host)" -ForegroundColor Yellow
Write-Host ""

# Предлагаем использовать curl для удаления
$useApi = Read-Host "Do you want to try deleting via API? (y/n)"

if ($useApi -eq 'y' -or $useApi -eq 'Y') {
    Write-Host ""
    Write-Host "Deleting queues via API..." -ForegroundColor Yellow
    
    $deletedCount = 0
    $failedCount = 0
    
    foreach ($queueName in $queuesToDelete) {
        try {
            # Используем RabbitMQ Management API
            $uri = "http://localhost:15672/api/queues/%2F/$queueName"
            $cred = [System.Convert]::ToBase64String([System.Text.Encoding]::ASCII.GetBytes("guest:guest"))
            
            $response = Invoke-RestMethod -Uri $uri `
                -Method Delete `
                -Headers @{
                    "Authorization" = "Basic $cred"
                } `
                -ErrorAction Stop
            
            Write-Host "  OK: Deleted queue '$queueName'" -ForegroundColor Green
            $deletedCount++
        } catch {
            if ($_.Exception.Response.StatusCode -eq 404) {
                Write-Host "  SKIP: Queue '$queueName' not found (already deleted?)" -ForegroundColor Gray
            } else {
                Write-Host "  ERROR: Failed to delete queue '$queueName': $($_.Exception.Message)" -ForegroundColor Red
                $failedCount++
            }
        }
    }
    
    Write-Host ""
    Write-Host "Summary:" -ForegroundColor Cyan
    Write-Host "  Deleted: $deletedCount" -ForegroundColor Green
    Write-Host "  Failed: $failedCount" -ForegroundColor $(if ($failedCount -gt 0) { "Red" } else { "Gray" })
} else {
    Write-Host ""
    Write-Host "Manual deletion selected." -ForegroundColor Yellow
    Write-Host "Please delete queues manually via RabbitMQ Management UI." -ForegroundColor White
}

Write-Host ""
Write-Host "Done!" -ForegroundColor Green
Write-Host ""

