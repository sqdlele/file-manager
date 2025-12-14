using System.Security.Cryptography;
using System.Text;
using AuthApp.Models;

namespace AuthApp.Services;

public class UserService
{
    private readonly List<User> _users = new();
    private int _nextId = 1;
    private readonly IRabbitMqService _rabbitMqService;
    private readonly IConfiguration _configuration;
    private readonly ILogger<UserService> _logger;

    public UserService(IRabbitMqService rabbitMqService, IConfiguration configuration, ILogger<UserService> logger)
    {
        _rabbitMqService = rabbitMqService;
        _configuration = configuration;
        _logger = logger;
    }

    public async Task<User?> RegisterAsync(string username, string email, string password)
    {
        // Проверяем, существует ли пользователь
        if (_users.Any(u => u.Username.Equals(username, StringComparison.OrdinalIgnoreCase) ||
                           u.Email.Equals(email, StringComparison.OrdinalIgnoreCase)))
        {
            return null; // Пользователь уже существует
        }

        // Создаем нового пользователя
        var user = new User
        {
            Id = _nextId++,
            Username = username,
            Email = email,
            PasswordHash = HashPassword(password),
            CreatedAt = DateTime.UtcNow
        };

        _users.Add(user);

        // Отправляем сообщение в RabbitMQ
        var queueName = _configuration["RabbitMQ:RegistrationQueueName"] ?? "user_registrations";
        var message = System.Text.Json.JsonSerializer.Serialize(new
        {
            userId = user.Id,
            username = user.Username,
            email = user.Email,
            registeredAt = user.CreatedAt,
            eventType = "user_registered"
        });

        var sent = await _rabbitMqService.PublishMessageAsync(queueName, message);
        if (sent)
        {
            _logger.LogInformation("Сообщение о регистрации пользователя {Username} отправлено в очередь {QueueName}", username, queueName);
        }
        else
        {
            _logger.LogWarning("Не удалось отправить сообщение о регистрации пользователя {Username}", username);
        }

        return user;
    }

    public User? Login(string username, string password)
    {
        var user = _users.FirstOrDefault(u => 
            u.Username.Equals(username, StringComparison.OrdinalIgnoreCase));

        if (user == null)
            return null;

        if (VerifyPassword(password, user.PasswordHash))
            return user;

        return null;
    }

    private string HashPassword(string password)
    {
        using var sha256 = SHA256.Create();
        var hashedBytes = sha256.ComputeHash(Encoding.UTF8.GetBytes(password));
        return Convert.ToBase64String(hashedBytes);
    }

    private bool VerifyPassword(string password, string hash)
    {
        var passwordHash = HashPassword(password);
        return passwordHash == hash;
    }
}

