using AuthApp.Services;

var builder = WebApplication.CreateBuilder(args);

// Add services
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSingleton<IRabbitMqService, RabbitMqService>();
builder.Services.AddSingleton<UserService>();

// CORS для работы с фронтендом
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyMethod()
              .AllowAnyHeader();
    });
});

var app = builder.Build();

// Configure the HTTP request pipeline
app.UseCors();

// Важно: UseDefaultFiles должен быть ПЕРЕД UseStaticFiles
app.UseDefaultFiles();
app.UseStaticFiles();

// Явный маршрут для главной страницы
app.MapGet("/", async (HttpContext context) =>
{
    var webRootPath = app.Environment.WebRootPath ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot");
    var indexPath = Path.Combine(webRootPath, "index.html");
    
    if (File.Exists(indexPath))
    {
        context.Response.ContentType = "text/html; charset=utf-8";
        await context.Response.SendFileAsync(indexPath);
    }
    else
    {
        context.Response.StatusCode = 404;
        await context.Response.WriteAsync($"File not found. Path: {indexPath}");
    }
});

app.MapControllers();

app.Run();
