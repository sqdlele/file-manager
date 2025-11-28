using TasksManager.Api.Hubs;
using TasksManager.Api.Services;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container
builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
    });
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddOpenApi();

// Add SignalR
builder.Services.AddSignalR(options =>
{
    options.EnableDetailedErrors = true;
});

// CORS больше не нужен, так как все на одном хосте

// Add services
builder.Services.AddSingleton<ITaskManagerService, TaskManagerService>();

var app = builder.Build();

// Configure the HTTP request pipeline
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseAuthorization();

// Serve static files from wwwroot (используется только в продакшене)
// В режиме разработки используйте Vite dev server (npm run dev)
app.UseDefaultFiles();
app.UseStaticFiles();

app.MapControllers();

// Map SignalR Hub
app.MapHub<TaskHub>("/taskhub");

// Fallback to index.html for SPA routing
app.MapFallbackToFile("index.html");

app.Run();
