using Microsoft.AspNetCore.Mvc;
using AuthApp.Models;
using AuthApp.Services;

namespace AuthApp.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly UserService _userService;
    private readonly ILogger<AuthController> _logger;

    public AuthController(UserService userService, ILogger<AuthController> logger)
    {
        _userService = userService;
        _logger = logger;
    }

    [HttpPost("register")]
    public async Task<IActionResult> Register([FromBody] RegisterRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Username) || 
            string.IsNullOrWhiteSpace(request.Email) || 
            string.IsNullOrWhiteSpace(request.Password))
        {
            return BadRequest(new { error = "Все поля обязательны для заполнения" });
        }

        var user = await _userService.RegisterAsync(request.Username, request.Email, request.Password);

        if (user == null)
        {
            return BadRequest(new { error = "Пользователь с таким именем или email уже существует" });
        }

        return Ok(new 
        { 
            message = "Регистрация успешна! Сообщение отправлено в RabbitMQ.",
            user = new { id = user.Id, username = user.Username, email = user.Email }
        });
    }

    [HttpPost("login")]
    public IActionResult Login([FromBody] LoginRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Username) || 
            string.IsNullOrWhiteSpace(request.Password))
        {
            return BadRequest(new { error = "Имя пользователя и пароль обязательны" });
        }

        var user = _userService.Login(request.Username, request.Password);

        if (user == null)
        {
            return Unauthorized(new { error = "Неверное имя пользователя или пароль" });
        }

        return Ok(new 
        { 
            message = "Вход выполнен успешно",
            user = new { id = user.Id, username = user.Username, email = user.Email }
        });
    }
}

