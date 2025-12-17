using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.FileProviders;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Processing;

var builder = WebApplication.CreateBuilder(args);

const long MaxUploadBytes = 75L * 1024 * 1024; // 75 MB

// Ширина миниатюры для превью (используется в UI, чтобы не грузить оригиналы)
const int PreviewWidthPx = 320;

// Целевые ширины для ресайза изображений
var resizeWidths = new[] { 720, 1080, 1260, 1920, 2440 };

// Лимиты на multipart/form-data
builder.Services.Configure<FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = MaxUploadBytes;
});

// Лимиты на размер тела запроса (Kestrel/IIS)
builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxRequestBodySize = MaxUploadBytes;
});
builder.Services.Configure<IISServerOptions>(options =>
{
    options.MaxRequestBodySize = MaxUploadBytes;
});

// Add services to the container.
// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();
builder.Services.AddAntiforgery();

var app = builder.Build();

// Optional base path (e.g. "/jmaka") for running behind Nginx under a sub-path.
// If not set or equals "/" -> app is mounted at root.
var basePath = Environment.GetEnvironmentVariable("JMAKA_BASE_PATH");
if (!string.IsNullOrWhiteSpace(basePath) && basePath != "/")
{
    if (!basePath.StartsWith('/'))
    {
        basePath = "/" + basePath;
    }

    basePath = basePath.TrimEnd('/');
    if (basePath.Length > 1)
    {
        app.UsePathBase(basePath);
    }
}

// Ensure directories exist
// Важно для деплоя: данные (upload/resized/preview/data) можно вынести из папки приложения.
// По умолчанию всё остаётся рядом с приложением (ContentRootPath).
var storageRoot = Environment.GetEnvironmentVariable("JMAKA_STORAGE_ROOT");
if (string.IsNullOrWhiteSpace(storageRoot))
{
    storageRoot = app.Environment.ContentRootPath;
}

var uploadDir = Path.Combine(storageRoot, "upload");
var resizedDir = Path.Combine(storageRoot, "resized");
var previewDir = Path.Combine(storageRoot, "preview");
var dataDir = Path.Combine(storageRoot, "data");
var historyPath = Path.Combine(dataDir, "history.json");
Directory.CreateDirectory(uploadDir);
Directory.CreateDirectory(resizedDir);
Directory.CreateDirectory(previewDir);
Directory.CreateDirectory(dataDir);
foreach (var w in resizeWidths)
{
    Directory.CreateDirectory(Path.Combine(resizedDir, w.ToString()));
}

var historyLock = new SemaphoreSlim(1, 1);

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseHttpsRedirection();

// Web UI (static files)
app.UseDefaultFiles();
app.UseStaticFiles();

// Serve runtime files (resized/original uploads)
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(resizedDir),
    RequestPath = "/resized"
});
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(uploadDir),
    RequestPath = "/upload"
});
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(previewDir),
    RequestPath = "/preview"
});

app.UseAntiforgery();

app.MapGet("/history", async Task<IResult> (CancellationToken ct) =>
{
    var items = await ReadHistoryAsync(historyPath, historyLock, ct);
    return Results.Ok(items.OrderByDescending(x => x.CreatedAt).Take(200));
});

app.MapPost("/delete", async Task<IResult> (DeleteRequest req, CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(req.StoredName))
    {
        return Results.BadRequest(new { error = "storedName is required" });
    }

    // Защита от path traversal
    var storedName = Path.GetFileName(req.StoredName);
    if (!string.Equals(storedName, req.StoredName, StringComparison.Ordinal))
    {
        return Results.BadRequest(new { error = "invalid storedName" });
    }

    var removed = await RemoveHistoryEntryAsync(historyPath, historyLock, storedName, ct);
    if (!removed)
    {
        return Results.NotFound(new { error = "not found" });
    }

    // Удаляем оригинал
    TryDeleteFile(Path.Combine(uploadDir, storedName));

    // Удаляем превью
    TryDeleteFile(Path.Combine(previewDir, storedName));

    // Удаляем все ресайзы
    foreach (var w in resizeWidths)
    {
        TryDeleteFile(Path.Combine(resizedDir, w.ToString(), storedName));
    }

    return Results.Ok(new { ok = true, storedName });
})
.DisableAntiforgery()
.Accepts<DeleteRequest>("application/json")
.Produces(StatusCodes.Status200OK)
.Produces(StatusCodes.Status400BadRequest)
.Produces(StatusCodes.Status404NotFound);

app.MapPost("/upload", async Task<IResult> (IFormFile file, CancellationToken ct) =>
{
    if (file is null)
    {
        return Results.BadRequest(new { error = "file is required" });
    }

    if (file.Length <= 0)
    {
        return Results.BadRequest(new { error = "file is empty" });
    }

    if (file.Length > MaxUploadBytes)
    {
        return Results.BadRequest(new { error = $"file is too large (max {MaxUploadBytes} bytes)" });
    }

    var ext = SanitizeExtension(Path.GetExtension(file.FileName));
    var storedName = $"{Guid.NewGuid():N}{ext}";

    // Оригинал всегда сохраняем в upload/
    var originalAbsolutePath = Path.Combine(uploadDir, storedName);

    await using (var stream = File.Create(originalAbsolutePath))
    {
        await file.CopyToAsync(stream, ct);
    }

    var imageInfo = await TryGetImageInfoAsync(originalAbsolutePath, ct);

    // Генерируем миниатюру для превью (если это изображение)
    string? previewRelativePath = null;
    if (imageInfo.Width > 0 && imageInfo.Height > 0)
    {
        var previewAbsolutePath = Path.Combine(previewDir, storedName);
        previewRelativePath = $"preview/{storedName}";
        await CreatePreviewImageAsync(originalAbsolutePath, previewAbsolutePath, PreviewWidthPx, ct);
    }

    var entry = new UploadHistoryItem(
        StoredName: storedName,
        OriginalName: file.FileName,
        CreatedAt: DateTimeOffset.UtcNow,
        Size: file.Length,
        OriginalRelativePath: $"upload/{storedName}",
        PreviewRelativePath: previewRelativePath,
        ImageWidth: imageInfo.Width > 0 ? imageInfo.Width : null,
        ImageHeight: imageInfo.Height > 0 ? imageInfo.Height : null,
        Resized: new Dictionary<int, string>()
    );

    await AppendHistoryAsync(historyPath, historyLock, entry, ct);

    return Results.Ok(new
    {
        originalName = entry.OriginalName,
        storedName = entry.StoredName,
        createdAt = entry.CreatedAt,
        size = entry.Size,
        originalRelativePath = entry.OriginalRelativePath,
        previewRelativePath = entry.PreviewRelativePath,
        imageWidth = entry.ImageWidth,
        imageHeight = entry.ImageHeight,
        resized = entry.Resized
    });
})
.DisableAntiforgery()
.Accepts<IFormFile>("multipart/form-data")
.Produces(StatusCodes.Status200OK)
.Produces(StatusCodes.Status400BadRequest);

app.MapPost("/resize", async Task<IResult> (ResizeRequest req, CancellationToken ct) =>
{
    if (req.Width <= 0)
    {
        return Results.BadRequest(new { error = "width must be > 0" });
    }

    if (!resizeWidths.Contains(req.Width))
    {
        return Results.BadRequest(new { error = "unsupported width" });
    }

    if (string.IsNullOrWhiteSpace(req.StoredName))
    {
        return Results.BadRequest(new { error = "storedName is required" });
    }

    // Защита от path traversal
    var storedName = Path.GetFileName(req.StoredName);
    if (!string.Equals(storedName, req.StoredName, StringComparison.Ordinal))
    {
        return Results.BadRequest(new { error = "invalid storedName" });
    }

    var originalAbsolutePath = Path.Combine(uploadDir, storedName);
    if (!File.Exists(originalAbsolutePath))
    {
        return Results.NotFound(new { error = "original file not found" });
    }

    // Проверим, что это изображение и что не делаем апскейл
    var info = await TryGetImageInfoAsync(originalAbsolutePath, ct);
    if (info.Width <= 0 || info.Height <= 0)
    {
        return Results.BadRequest(new { error = "file is not a supported image" });
    }

    if (req.Width >= info.Width)
    {
        return Results.BadRequest(new { error = "upscale is not allowed" });
    }

    var outDir = Path.Combine(resizedDir, req.Width.ToString());
    Directory.CreateDirectory(outDir);

    var outPath = Path.Combine(outDir, storedName);
    var relPath = $"resized/{req.Width}/{storedName}";

    // Если уже есть — просто вернём ссылку и обновим историю (идемпотентно)
    if (File.Exists(outPath))
    {
        await UpsertResizedInHistoryAsync(historyPath, historyLock, storedName, req.Width, relPath, ct);
        return Results.Ok(new { width = req.Width, relativePath = relPath });
    }

    // Ресайз
    await CreateResizedImageAsync(originalAbsolutePath, outPath, req.Width, ct);
    await UpsertResizedInHistoryAsync(historyPath, historyLock, storedName, req.Width, relPath, ct);

    return Results.Ok(new { width = req.Width, relativePath = relPath });
})
.DisableAntiforgery()
.Accepts<ResizeRequest>("application/json")
.Produces(StatusCodes.Status200OK)
.Produces(StatusCodes.Status400BadRequest)
.Produces(StatusCodes.Status404NotFound);

app.MapPost("/crop", async Task<IResult> (CropRequest req, CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(req.StoredName))
    {
        return Results.BadRequest(new { error = "storedName is required" });
    }

    // Защита от path traversal
    var storedName = Path.GetFileName(req.StoredName);
    if (!string.Equals(storedName, req.StoredName, StringComparison.Ordinal))
    {
        return Results.BadRequest(new { error = "invalid storedName" });
    }

    if (req.Width <= 0 || req.Height <= 0)
    {
        return Results.BadRequest(new { error = "invalid crop size" });
    }

    var originalAbsolutePath = Path.Combine(uploadDir, storedName);
    if (!File.Exists(originalAbsolutePath))
    {
        return Results.NotFound(new { error = "original file not found" });
    }

    // Загружаем изображение
    // IMPORTANT: do not keep the file stream open while overwriting the original.
    Image image;
    await using (var input = new FileStream(originalAbsolutePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
    {
        image = await Image.LoadAsync(input, ct);
    }

    using (image)
    {
        var imgW = image.Width;
        var imgH = image.Height;
        if (imgW <= 0 || imgH <= 0)
        {
            return Results.BadRequest(new { error = "invalid image" });
        }

        // Клэмпим прямоугольник в границы
        var x = Math.Clamp(req.X, 0, imgW - 1);
        var y = Math.Clamp(req.Y, 0, imgH - 1);
        var w = Math.Clamp(req.Width, 1, imgW - x);
        var h = Math.Clamp(req.Height, 1, imgH - y);

        // Принудительно приводим к 16:9 (на всякий случай)
        // Берём ширину как базу и пересчитываем высоту.
        var targetH = (int)Math.Round(w * 9.0 / 16.0);
        if (targetH <= 0) targetH = 1;
        if (targetH > h)
        {
            // если высоты не хватает — подгоняем ширину под высоту
            var targetW = (int)Math.Round(h * 16.0 / 9.0);
            targetW = Math.Max(1, targetW);
            w = Math.Min(w, targetW);
            h = Math.Min(h, (int)Math.Round(w * 9.0 / 16.0));
        }
        else
        {
            h = targetH;
        }

        // Переклэмпим после подгонки
        if (x + w > imgW) w = imgW - x;
        if (y + h > imgH) h = imgH - y;

        image.Mutate(ctx => ctx.Crop(new Rectangle(x, y, w, h)));

        // Сохраняем поверх оригинала (атомарно)
        await SaveImageWithSafeTempAsync(image, originalAbsolutePath, ct);

        // Пересоздаём preview
        var previewAbsolutePath = Path.Combine(previewDir, storedName);
        await CreatePreviewImageAsync(originalAbsolutePath, previewAbsolutePath, PreviewWidthPx, ct);

        // Удаляем все ресайзы, т.к. они больше не соответствуют новому оригиналу
        foreach (var rw in resizeWidths)
        {
            TryDeleteFile(Path.Combine(resizedDir, rw.ToString(), storedName));
        }

        // Обновляем историю: размеры и сброс resized
        await UpdateHistoryAfterCropAsync(historyPath, historyLock, storedName, w, h, ct);

        return Results.Ok(new
        {
            ok = true,
            storedName,
            imageWidth = w,
            imageHeight = h,
            previewRelativePath = $"preview/{storedName}",
            originalRelativePath = $"upload/{storedName}"
        });
    }
})
.DisableAntiforgery()
.Accepts<CropRequest>("application/json")
.Produces(StatusCodes.Status200OK)
.Produces(StatusCodes.Status400BadRequest)
.Produces(StatusCodes.Status404NotFound);

app.Run();

static async Task<ImageInfo> TryGetImageInfoAsync(string absolutePath, CancellationToken ct)
{
    var ext = Path.GetExtension(absolutePath);
    if (!IsLikelyImageExtension(ext))
    {
        return new ImageInfo(0, 0);
    }

    try
    {
        await using var input = File.OpenRead(absolutePath);
        using var image = await Image.LoadAsync(input, ct);
        return new ImageInfo(image.Width, image.Height);
    }
    catch
    {
        return new ImageInfo(0, 0);
    }
}

static async Task CreateResizedImageAsync(
    string originalAbsolutePath,
    string outAbsolutePath,
    int targetWidthPx,
    CancellationToken ct)
{
    await using var input = File.OpenRead(originalAbsolutePath);
    using var image = await Image.LoadAsync(input, ct);

    var imageWidth = image.Width;
    var imageHeight = image.Height;

    if (imageWidth <= 0 || imageHeight <= 0)
    {
        throw new InvalidOperationException("Invalid image");
    }

    if (targetWidthPx >= imageWidth)
    {
        throw new InvalidOperationException("Upscale is not allowed");
    }

    var newHeight = (int)Math.Round(imageHeight * (targetWidthPx / (double)imageWidth));
    newHeight = Math.Max(1, newHeight);

    image.Mutate(x => x.Resize(targetWidthPx, newHeight));

    await SaveImageWithSafeTempAsync(image, outAbsolutePath, ct);
}

static async Task CreatePreviewImageAsync(
    string originalAbsolutePath,
    string outAbsolutePath,
    int targetWidthPx,
    CancellationToken ct)
{
    await using var input = File.OpenRead(originalAbsolutePath);
    using var image = await Image.LoadAsync(input, ct);

    if (image.Width <= 0 || image.Height <= 0)
    {
        return;
    }

    // Не апскейлим: если картинка уже меньше — просто копируем.
    if (targetWidthPx <= 0 || image.Width <= targetWidthPx)
    {
        File.Copy(originalAbsolutePath, outAbsolutePath, overwrite: true);
        return;
    }

    var newHeight = (int)Math.Round(image.Height * (targetWidthPx / (double)image.Width));
    newHeight = Math.Max(1, newHeight);

    image.Mutate(x => x.Resize(targetWidthPx, newHeight));

    await SaveImageWithSafeTempAsync(image, outAbsolutePath, ct);
}

static async Task SaveImageWithSafeTempAsync(Image image, string outAbsolutePath, CancellationToken ct)
{
    var ext = Path.GetExtension(outAbsolutePath);
    var dir = Path.GetDirectoryName(outAbsolutePath) ?? throw new InvalidOperationException("Invalid output path");
    var fileNoExt = Path.GetFileNameWithoutExtension(outAbsolutePath);

    // Важно: расширение temp-файла должно оставаться "картинным" (например .jpg),
    // иначе ImageSharp не сможет подобрать encoder при SaveAsync().
    var tempPath = Path.Combine(dir, $"{fileNoExt}.tmp{ext}");

    await image.SaveAsync(tempPath, ct);

    // Prefer atomic replace.
    // On Linux, this should succeed even if the old file is being read.
    try
    {
        File.Move(tempPath, outAbsolutePath, overwrite: true);
    }
    catch
    {
        // Fallback for platforms/filesystems where Move-overwrite isn't supported.
        File.Copy(tempPath, outAbsolutePath, overwrite: true);
        File.Delete(tempPath);
    }
}

static bool IsLikelyImageExtension(string? ext)
{
    if (string.IsNullOrWhiteSpace(ext))
    {
        return false;
    }

    return ext.Equals(".jpg", StringComparison.OrdinalIgnoreCase)
        || ext.Equals(".jpeg", StringComparison.OrdinalIgnoreCase)
        || ext.Equals(".png", StringComparison.OrdinalIgnoreCase)
        || ext.Equals(".webp", StringComparison.OrdinalIgnoreCase)
        || ext.Equals(".bmp", StringComparison.OrdinalIgnoreCase)
        || ext.Equals(".gif", StringComparison.OrdinalIgnoreCase);
}

static string SanitizeExtension(string? ext)
{
    if (string.IsNullOrWhiteSpace(ext))
    {
        return string.Empty;
    }

    // Оставляем только '.', буквы/цифры; иначе убираем расширение.
    var sb = new StringBuilder(ext.Length);
    foreach (var ch in ext)
    {
        if (ch == '.' || char.IsLetterOrDigit(ch))
        {
            sb.Append(ch);
        }
    }

    var cleaned = sb.ToString();
    if (cleaned.Length > 16) // защита от очень длинных “расширений”
    {
        return string.Empty;
    }

    return cleaned;
}

static async Task<List<UploadHistoryItem>> ReadHistoryAsync(string historyPath, SemaphoreSlim historyLock, CancellationToken ct)
{
    await historyLock.WaitAsync(ct);
    try
    {
        if (!File.Exists(historyPath))
        {
            return new List<UploadHistoryItem>();
        }

        var json = await File.ReadAllTextAsync(historyPath, ct);
        if (string.IsNullOrWhiteSpace(json))
        {
            return new List<UploadHistoryItem>();
        }

        return JsonSerializer.Deserialize<List<UploadHistoryItem>>(json) ?? new List<UploadHistoryItem>();
    }
    catch
    {
        return new List<UploadHistoryItem>();
    }
    finally
    {
        historyLock.Release();
    }
}

static async Task WriteHistoryAsync(string historyPath, SemaphoreSlim historyLock, List<UploadHistoryItem> items, CancellationToken ct)
{
    await historyLock.WaitAsync(ct);
    try
    {
        var json = JsonSerializer.Serialize(items, new JsonSerializerOptions { WriteIndented = true });
        await File.WriteAllTextAsync(historyPath, json, ct);
    }
    finally
    {
        historyLock.Release();
    }
}

static async Task AppendHistoryAsync(string historyPath, SemaphoreSlim historyLock, UploadHistoryItem entry, CancellationToken ct)
{
    var items = await ReadHistoryAsync(historyPath, historyLock, ct);
    items.Add(entry);
    await WriteHistoryAsync(historyPath, historyLock, items, ct);
}

static void TryDeleteFile(string path)
{
    try
    {
        if (File.Exists(path))
        {
            File.Delete(path);
        }
    }
    catch
    {
        // ignore
    }
}

static async Task<bool> RemoveHistoryEntryAsync(
    string historyPath,
    SemaphoreSlim historyLock,
    string storedName,
    CancellationToken ct)
{
    // Делается под lock через Read/Write, чтобы не ломать файл при параллельных запросах.
    var items = await ReadHistoryAsync(historyPath, historyLock, ct);
    var before = items.Count;
    items = items.Where(x => !string.Equals(x.StoredName, storedName, StringComparison.Ordinal)).ToList();
    if (items.Count == before)
    {
        return false;
    }

    await WriteHistoryAsync(historyPath, historyLock, items, ct);
    return true;
}

static async Task UpsertResizedInHistoryAsync(
    string historyPath,
    SemaphoreSlim historyLock,
    string storedName,
    int width,
    string relativePath,
    CancellationToken ct)
{
    var items = await ReadHistoryAsync(historyPath, historyLock, ct);
    for (var i = items.Count - 1; i >= 0; i--)
    {
        if (!string.Equals(items[i].StoredName, storedName, StringComparison.Ordinal))
        {
            continue;
        }

        var resized = items[i].Resized ?? new Dictionary<int, string>();
        resized[width] = relativePath;
        items[i] = items[i] with { Resized = resized };
        await WriteHistoryAsync(historyPath, historyLock, items, ct);
        return;
    }
}

static async Task UpdateHistoryAfterCropAsync(
    string historyPath,
    SemaphoreSlim historyLock,
    string storedName,
    int newWidth,
    int newHeight,
    CancellationToken ct)
{
    var items = await ReadHistoryAsync(historyPath, historyLock, ct);
    for (var i = items.Count - 1; i >= 0; i--)
    {
        if (!string.Equals(items[i].StoredName, storedName, StringComparison.Ordinal))
        {
            continue;
        }

        items[i] = items[i] with
        {
            ImageWidth = newWidth,
            ImageHeight = newHeight,
            PreviewRelativePath = $"preview/{storedName}",
            Resized = new Dictionary<int, string>()
        };
        await WriteHistoryAsync(historyPath, historyLock, items, ct);
        return;
    }
}

record ImageInfo(int Width, int Height);
record ResizeRequest(string StoredName, int Width);
record DeleteRequest(string StoredName);
record CropRequest(string StoredName, int X, int Y, int Width, int Height);
record UploadHistoryItem(
    string StoredName,
    string OriginalName,
    DateTimeOffset CreatedAt,
    long Size,
    string OriginalRelativePath,
    string? PreviewRelativePath,
    int? ImageWidth,
    int? ImageHeight,
    Dictionary<int, string> Resized
);
