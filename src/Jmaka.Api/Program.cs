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
var resizeWidths = new[] { 1280, 1920, 2440 };

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
var uploadOriginalDir = Path.Combine(storageRoot, "upload-original");
var resizedDir = Path.Combine(storageRoot, "resized");
var previewDir = Path.Combine(storageRoot, "preview");
var splitDir = Path.Combine(storageRoot, "split");
var split3Dir = Path.Combine(storageRoot, "split3");
var trashDir = Path.Combine(storageRoot, "trashimg");
var dataDir = Path.Combine(storageRoot, "data");
var historyPath = Path.Combine(dataDir, "history.json");
var compositesPath = Path.Combine(dataDir, "composites.json");
Directory.CreateDirectory(uploadDir);
Directory.CreateDirectory(uploadOriginalDir);
Directory.CreateDirectory(resizedDir);
Directory.CreateDirectory(previewDir);
Directory.CreateDirectory(splitDir);
Directory.CreateDirectory(split3Dir);
Directory.CreateDirectory(trashDir);
Directory.CreateDirectory(dataDir);
foreach (var w in resizeWidths)
{
    Directory.CreateDirectory(Path.Combine(resizedDir, w.ToString()));
}

var historyLock = new SemaphoreSlim(1, 1);
var compositesLock = new SemaphoreSlim(1, 1);

// Retention: delete entries/files older than N hours (default 48h)
var retentionHours = 48;
var retentionEnv = Environment.GetEnvironmentVariable("JMAKA_RETENTION_HOURS");
if (!string.IsNullOrWhiteSpace(retentionEnv)
    && int.TryParse(retentionEnv, out var parsedRetentionHours)
    && parsedRetentionHours > 0)
{
    retentionHours = parsedRetentionHours;
}
var retention = TimeSpan.FromHours(retentionHours);

string GetSplitFileName(string storedName)
{
    // One split result per source image (slot #1): split/<storedName-noext>.jpg
    var name = Path.GetFileNameWithoutExtension(storedName);
    return $"{name}.jpg";
}

string GetSplit3FileName(string storedName)
{
    // One split3 result per source image (slot #1): split3/<storedName-noext>.jpg
    var name = Path.GetFileNameWithoutExtension(storedName);
    return $"{name}.jpg";
}

string MakeCompositeFileName()
{
    // e.g. 20260110-112233-123-<guid>.jpg
    var ts = DateTimeOffset.UtcNow.ToString("yyyyMMdd-HHmmss-fff");
    return $"{ts}-{Guid.NewGuid():N}.jpg";
}

string? GetCompositeAbsolutePath(CompositeHistoryItem it)
{
    if (it is null || string.IsNullOrWhiteSpace(it.Kind) || string.IsNullOrWhiteSpace(it.RelativePath))
    {
        return null;
    }

    var fileName = Path.GetFileName(it.RelativePath);
    if (string.IsNullOrWhiteSpace(fileName))
    {
        return null;
    }

    if (string.Equals(it.Kind, "split3", StringComparison.OrdinalIgnoreCase))
    {
        return Path.Combine(split3Dir, fileName);
    }

    if (string.Equals(it.Kind, "trashimg", StringComparison.OrdinalIgnoreCase)
        || string.Equals(it.Kind, "oknoscale", StringComparison.OrdinalIgnoreCase))
    {
        return Path.Combine(trashDir, fileName);
    }

    return Path.Combine(splitDir, fileName);
}

void DeleteCompositesForStoredName(string storedName)
{
    // Remove composite outputs that were created from this storedName.
    compositesLock.Wait();
    try
    {
        if (!File.Exists(compositesPath))
        {
            return;
        }

        var json = File.ReadAllText(compositesPath);
        if (string.IsNullOrWhiteSpace(json))
        {
            return;
        }

        var items = JsonSerializer.Deserialize<List<CompositeHistoryItem>>(json) ?? new List<CompositeHistoryItem>();
        if (items.Count == 0)
        {
            return;
        }

        var removed = items.Where(x => x.Sources != null && x.Sources.Any(s => string.Equals(s, storedName, StringComparison.Ordinal))).ToList();
        if (removed.Count == 0)
        {
            return;
        }

        var kept = items.Where(x => !(x.Sources != null && x.Sources.Any(s => string.Equals(s, storedName, StringComparison.Ordinal)))).ToList();
        var outJson = JsonSerializer.Serialize(kept, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(compositesPath, outJson);

        foreach (var it in removed)
        {
            try
            {
                var abs = GetCompositeAbsolutePath(it);
                if (!string.IsNullOrWhiteSpace(abs))
                {
                    TryDeleteFile(abs);
                }
            }
            catch
            {
                // ignore
            }
        }
    }
    catch
    {
        // ignore
    }
    finally
    {
        compositesLock.Release();
    }
}

void DeleteAllFilesForStoredName(string storedName)
{
    // originals
    TryDeleteFile(Path.Combine(uploadDir, storedName));
    TryDeleteFile(Path.Combine(uploadOriginalDir, storedName));

    // preview
    TryDeleteFile(Path.Combine(previewDir, storedName));

    // legacy deterministic split outputs
    TryDeleteFile(Path.Combine(splitDir, GetSplitFileName(storedName)));
    TryDeleteFile(Path.Combine(split3Dir, GetSplit3FileName(storedName)));

    // composites created from this image
    DeleteCompositesForStoredName(storedName);

    // resized
    foreach (var w in resizeWidths)
    {
        TryDeleteFile(Path.Combine(resizedDir, w.ToString(), storedName));
    }
}

var migrate1260Lock = new SemaphoreSlim(1, 1);

async Task Migrate1260To1280Async(CancellationToken ct)
{
    // Old versions used resized/1260/<storedName>. New version uses resized/1280/<storedName>.
    // We migrate history.json and move files if present.
    await migrate1260Lock.WaitAsync(ct);
    try
    {
        await historyLock.WaitAsync(ct);
        try
        {
            if (!File.Exists(historyPath))
            {
                return;
            }

            var json = await File.ReadAllTextAsync(historyPath, ct);
            if (string.IsNullOrWhiteSpace(json))
            {
                return;
            }

            var items = JsonSerializer.Deserialize<List<UploadHistoryItem>>(json) ?? new List<UploadHistoryItem>();
            if (items.Count == 0)
            {
                return;
            }

            var changed = false;
            for (var i = 0; i < items.Count; i++)
            {
                var it = items[i];
                var resized = it.Resized;
                if (resized is null || resized.Count == 0)
                {
                    continue;
                }

                if (!resized.ContainsKey(1260) || resized.ContainsKey(1280))
                {
                    continue;
                }

                // Try moving file on disk
                var srcPath = Path.Combine(resizedDir, "1260", it.StoredName);
                var dstDir = Path.Combine(resizedDir, "1280");
                Directory.CreateDirectory(dstDir);
                var dstPath = Path.Combine(dstDir, it.StoredName);

                if (File.Exists(srcPath) && !File.Exists(dstPath))
                {
                    try
                    {
                        File.Move(srcPath, dstPath);
                    }
                    catch
                    {
                        try
                        {
                            File.Copy(srcPath, dstPath, overwrite: true);
                            File.Delete(srcPath);
                        }
                        catch
                        {
                            // ignore
                        }
                    }
                }

                var newResized = new Dictionary<int, string>(resized);
                newResized.Remove(1260);
                newResized[1280] = $"resized/1280/{it.StoredName}";
                items[i] = it with { Resized = newResized };
                changed = true;
            }

            if (!changed)
            {
                return;
            }

            var outJson = JsonSerializer.Serialize(items, new JsonSerializerOptions { WriteIndented = true });
            await File.WriteAllTextAsync(historyPath, outJson, ct);
        }
        catch
        {
            // ignore
        }
        finally
        {
            historyLock.Release();
        }
    }
    finally
    {
        migrate1260Lock.Release();
    }
}

async Task PruneExpiredAsync(CancellationToken ct)
{
    // First, do a small legacy migration: old builds used width 1260, now it's 1280.
    // This keeps history + files consistent for existing installs.
    await Migrate1260To1280Async(ct);

    var cutoff = DateTimeOffset.UtcNow - retention;

    // 1) Prune upload history
    List<UploadHistoryItem> removedUploads = new();
    await historyLock.WaitAsync(ct);
    try
    {
        if (File.Exists(historyPath))
        {
            var json = await File.ReadAllTextAsync(historyPath, ct);
            if (!string.IsNullOrWhiteSpace(json))
            {
                var items = JsonSerializer.Deserialize<List<UploadHistoryItem>>(json) ?? new List<UploadHistoryItem>();
                removedUploads = items.Where(x => x.CreatedAt < cutoff).ToList();

                if (removedUploads.Count > 0)
                {
                    var kept = items.Where(x => x.CreatedAt >= cutoff).ToList();
                    var outJson = JsonSerializer.Serialize(kept, new JsonSerializerOptions { WriteIndented = true });
                    await File.WriteAllTextAsync(historyPath, outJson, ct);
                }
            }
        }
    }
    catch
    {
        // ignore retention failures
    }
    finally
    {
        historyLock.Release();
    }

    foreach (var it in removedUploads)
    {
        try { DeleteAllFilesForStoredName(it.StoredName); } catch { /* ignore */ }
    }

    // 2) Prune composites (Split/Split3 outputs)
    List<CompositeHistoryItem> removedComposites = new();
    await compositesLock.WaitAsync(ct);
    try
    {
        if (File.Exists(compositesPath))
        {
            var json = await File.ReadAllTextAsync(compositesPath, ct);
            if (!string.IsNullOrWhiteSpace(json))
            {
                var items = JsonSerializer.Deserialize<List<CompositeHistoryItem>>(json) ?? new List<CompositeHistoryItem>();
                removedComposites = items.Where(x => x.CreatedAt < cutoff).ToList();

                if (removedComposites.Count > 0)
                {
                    var kept = items.Where(x => x.CreatedAt >= cutoff).ToList();
                    var outJson = JsonSerializer.Serialize(kept, new JsonSerializerOptions { WriteIndented = true });
                    await File.WriteAllTextAsync(compositesPath, outJson, ct);
                }
            }
        }
    }
    catch
    {
        // ignore
    }
    finally
    {
        compositesLock.Release();
    }

    foreach (var it in removedComposites)
    {
        try
        {
            var abs = GetCompositeAbsolutePath(it);
            if (!string.IsNullOrWhiteSpace(abs))
            {
                TryDeleteFile(abs);
            }
        }
        catch
        {
            // ignore
        }
    }
}

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
// We overwrite these files in-place (crop, regenerate preview, recreate resized), so disable caching.
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(resizedDir),
    RequestPath = "/resized",
    OnPrepareResponse = ctx =>
    {
        ctx.Context.Response.Headers["Cache-Control"] = "no-store";
        ctx.Context.Response.Headers["Pragma"] = "no-cache";
        ctx.Context.Response.Headers["Expires"] = "0";
    }
});
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(uploadDir),
    RequestPath = "/upload",
    OnPrepareResponse = ctx =>
    {
        ctx.Context.Response.Headers["Cache-Control"] = "no-store";
        ctx.Context.Response.Headers["Pragma"] = "no-cache";
        ctx.Context.Response.Headers["Expires"] = "0";
    }
});
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(uploadOriginalDir),
    RequestPath = "/upload-original",
    OnPrepareResponse = ctx =>
    {
        ctx.Context.Response.Headers["Cache-Control"] = "no-store";
        ctx.Context.Response.Headers["Pragma"] = "no-cache";
        ctx.Context.Response.Headers["Expires"] = "0";
    }
});
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(previewDir),
    RequestPath = "/preview",
    OnPrepareResponse = ctx =>
    {
        ctx.Context.Response.Headers["Cache-Control"] = "no-store";
        ctx.Context.Response.Headers["Pragma"] = "no-cache";
        ctx.Context.Response.Headers["Expires"] = "0";
    }
});
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(splitDir),
    RequestPath = "/split",
    OnPrepareResponse = ctx =>
    {
        ctx.Context.Response.Headers["Cache-Control"] = "no-store";
        ctx.Context.Response.Headers["Pragma"] = "no-cache";
        ctx.Context.Response.Headers["Expires"] = "0";
    }
});
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(split3Dir),
    RequestPath = "/split3",
    OnPrepareResponse = ctx =>
    {
        ctx.Context.Response.Headers["Cache-Control"] = "no-store";
        ctx.Context.Response.Headers["Pragma"] = "no-cache";
        ctx.Context.Response.Headers["Expires"] = "0";
    }
});
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(trashDir),
    RequestPath = "/trashimg",
    OnPrepareResponse = ctx =>
    {
        ctx.Context.Response.Headers["Cache-Control"] = "no-store";
        ctx.Context.Response.Headers["Pragma"] = "no-cache";
        ctx.Context.Response.Headers["Expires"] = "0";
    }
});

app.UseAntiforgery();

// PNG-шаблон для TrashImg (готовая карточка с рамкой/тенью)
var trashOverlayPath = Path.Combine(app.Environment.ContentRootPath, "wwwroot", "jmaka-template-trash-001.png");

app.MapGet("/history", async Task<IResult> (CancellationToken ct) =>
{
    await PruneExpiredAsync(ct);
    var items = await ReadHistoryAsync(historyPath, historyLock, ct);
    return Results.Ok(items.OrderByDescending(x => x.CreatedAt).Take(200));
});

app.MapGet("/composites", async Task<IResult> (CancellationToken ct) =>
{
    await PruneExpiredAsync(ct);
    var items = await ReadCompositesAsync(compositesPath, compositesLock, ct);
    return Results.Ok(items.OrderByDescending(x => x.CreatedAt).Take(200));
});

app.MapPost("/delete-composite", async Task<IResult> (CompositeDeleteRequest req, CancellationToken ct) =>
{
    await PruneExpiredAsync(ct);

    if (string.IsNullOrWhiteSpace(req.RelativePath))
    {
        return Results.BadRequest(new { error = "relativePath is required" });
    }

    // Нормализуем путь (слеэши) и работаем по имени файла.
    var rel = req.RelativePath.Replace('\\', '/');
    var fileName = Path.GetFileName(rel);
    if (string.IsNullOrWhiteSpace(fileName))
    {
        return Results.BadRequest(new { error = "invalid relativePath" });
    }

    var items = await ReadCompositesAsync(compositesPath, compositesLock, ct);
    if (items.Count == 0)
    {
        return Results.NotFound(new { error = "not found" });
    }

    // Ищем по точному относительному пути или по имени файла на всякий случай.
    var toRemove = items.FirstOrDefault(x =>
        x != null &&
        (
            string.Equals(x.RelativePath.Replace('\\', '/'), rel, StringComparison.OrdinalIgnoreCase)
            || string.Equals(Path.GetFileName(x.RelativePath), fileName, StringComparison.OrdinalIgnoreCase)
        ));

    if (toRemove is null)
    {
        return Results.NotFound(new { error = "not found" });
    }

    var kept = items.Where(x => !ReferenceEquals(x, toRemove)).ToList();
    await WriteCompositesAsync(compositesPath, compositesLock, kept, ct);

    try
    {
        var abs = GetCompositeAbsolutePath(toRemove);
        if (!string.IsNullOrWhiteSpace(abs))
        {
            TryDeleteFile(abs);
        }
    }
    catch
    {
        // игнорируем ошибки удаления файла на диске
    }

    return Results.Ok(new { ok = true, relativePath = toRemove.RelativePath });
})
.DisableAntiforgery()
.Accepts<CompositeDeleteRequest>("application/json")
.Produces(StatusCodes.Status200OK)
.Produces(StatusCodes.Status400BadRequest)
.Produces(StatusCodes.Status404NotFound);

app.MapPost("/delete", async Task<IResult> (DeleteRequest req, CancellationToken ct) =>
{
    await PruneExpiredAsync(ct);
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

    // Delete all related files
    DeleteAllFilesForStoredName(storedName);

    return Results.Ok(new { ok = true, storedName });
})
.DisableAntiforgery()
.Accepts<DeleteRequest>("application/json")
.Produces(StatusCodes.Status200OK)
.Produces(StatusCodes.Status400BadRequest)
.Produces(StatusCodes.Status404NotFound);

app.MapPost("/upload", async Task<IResult> (HttpRequest request, CancellationToken ct) =>
{
    await PruneExpiredAsync(ct);

    IFormCollection form;
    try
    {
        form = await request.ReadFormAsync(ct);
    }
    catch
    {
        return Results.BadRequest(new { error = "invalid multipart form" });
    }

    var files = form.Files;
    if (files is null || files.Count == 0)
    {
        return Results.BadRequest(new { error = "file is required" });
    }

    if (files.Count > 15)
    {
        return Results.BadRequest(new { error = "too many files (max 15)" });
    }

    async Task<object> SaveOneAsync(IFormFile file)
    {
        if (file.Length <= 0)
        {
            throw new InvalidOperationException("file is empty");
        }

        if (file.Length > MaxUploadBytes)
        {
            throw new InvalidOperationException($"file is too large (max {MaxUploadBytes} bytes)");
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
            // Сохраняем неизменённую копию для crop (чтобы каждый раз резать заново исходник)
            var originalCopyAbsolutePath = Path.Combine(uploadOriginalDir, storedName);
            if (!File.Exists(originalCopyAbsolutePath))
            {
                File.Copy(originalAbsolutePath, originalCopyAbsolutePath);
            }

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

        return new
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
        };
    }

    try
    {
        var results = new List<object>(files.Count);
        foreach (var f in files)
        {
            results.Add(await SaveOneAsync(f));
        }

        return Results.Ok(results);
    }
    catch (Exception ex)
    {
        return Results.BadRequest(new { error = ex.Message });
    }
})
.DisableAntiforgery()
.Accepts<IFormFileCollection>("multipart/form-data")
.Produces(StatusCodes.Status200OK)
.Produces(StatusCodes.Status400BadRequest);

app.MapPost("/resize", async Task<IResult> (ResizeRequest req, CancellationToken ct) =>
{
    await PruneExpiredAsync(ct);
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

    // Проверим, что это изображение
    var info = await TryGetImageInfoAsync(originalAbsolutePath, ct);
    if (info.Width <= 0 || info.Height <= 0)
    {
        return Results.BadRequest(new { error = "file is not a supported image" });
    }

    // Разрешаем апскейл (пользователи хотят уметь увеличивать даже маленькие изображения)

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

app.MapPost("/split", async Task<IResult> (SplitRequest req, CancellationToken ct) =>
{
    await PruneExpiredAsync(ct);

    if (string.IsNullOrWhiteSpace(req.StoredNameA) || string.IsNullOrWhiteSpace(req.StoredNameB))
    {
        return Results.BadRequest(new { error = "storedNameA and storedNameB are required" });
    }

    // sanitize
    var storedNameA = Path.GetFileName(req.StoredNameA);
    var storedNameB = Path.GetFileName(req.StoredNameB);
    if (!string.Equals(storedNameA, req.StoredNameA, StringComparison.Ordinal)
        || !string.Equals(storedNameB, req.StoredNameB, StringComparison.Ordinal))
    {
        return Results.BadRequest(new { error = "invalid storedName" });
    }

    // split uses the current originals (upload/*). This avoids requiring pre-generated resized images.
    // NOTE: this reflects the current state (after crop, upload/<storedName> is updated).
    var srcA = Path.Combine(uploadDir, storedNameA);
    var srcB = Path.Combine(uploadDir, storedNameB);
    if (!File.Exists(srcA) || !File.Exists(srcB))
    {
        return Results.BadRequest(new { error = "original file not found" });
    }

    var infoA = await TryGetImageInfoAsync(srcA, ct);
    var infoB = await TryGetImageInfoAsync(srcB, ct);
    if (infoA.Width <= 0 || infoA.Height <= 0 || infoB.Width <= 0 || infoB.Height <= 0)
    {
        return Results.BadRequest(new { error = "file is not a supported image" });
    }

    const int outW = 1280;
    const int outH = 720;
    const int dividerW = 7;
    var leftW = (outW - dividerW) / 2; // 636
    var rightW = outW - dividerW - leftW; // 637

    var outFileName = MakeCompositeFileName();
    var outAbsolutePath = Path.Combine(splitDir, outFileName);
    var relPath = $"split/{outFileName}";

    try
    {
        using var left = new Image<SixLabors.ImageSharp.PixelFormats.Rgba32>(leftW, outH, new SixLabors.ImageSharp.PixelFormats.Rgba32(0, 0, 0, 255));
        using var right = new Image<SixLabors.ImageSharp.PixelFormats.Rgba32>(rightW, outH, new SixLabors.ImageSharp.PixelFormats.Rgba32(0, 0, 0, 255));

        static (int x, int y, int w, int h) MapRect(SplitViewRect r, int outHalfW, int outH)
        {
            var vw = r.ViewW <= 0 ? 1 : r.ViewW;
            var vh = r.ViewH <= 0 ? 1 : r.ViewH;
            var sx = outHalfW / vw;
            var sy = outH / vh;

            var x = (int)Math.Round(r.X * sx);
            var y = (int)Math.Round(r.Y * sy);
            var w = (int)Math.Round(r.W * sx);
            var h = (int)Math.Round(r.H * sy);
            return (x, y, Math.Max(1, w), Math.Max(1, h));
        }

        static async Task DrawAsync(Image<SixLabors.ImageSharp.PixelFormats.Rgba32> canvas, string srcPath, SplitViewRect r, int outHalfW, int outH, CancellationToken ct)
        {
            var (x, y, w, h) = MapRect(r, outHalfW, outH);
            await using var input = File.OpenRead(srcPath);
            using var img = await Image.LoadAsync<SixLabors.ImageSharp.PixelFormats.Rgba32>(input, ct);
            img.Mutate(p => p.Resize(w, h));
            canvas.Mutate(p => p.DrawImage(img, new Point(x, y), 1f));
        }

        await DrawAsync(left, srcA, req.A, leftW, outH, ct);
        await DrawAsync(right, srcB, req.B, rightW, outH, ct);

        using var output = new Image<SixLabors.ImageSharp.PixelFormats.Rgba32>(outW, outH, new SixLabors.ImageSharp.PixelFormats.Rgba32(0, 0, 0, 255));
        output.Mutate(p =>
        {
            p.DrawImage(left, new Point(0, 0), 1f);
            p.DrawImage(right, new Point(leftW + dividerW, 0), 1f);
        });

        // White divider (7px)
        var white = new SixLabors.ImageSharp.PixelFormats.Rgba32(255, 255, 255, 255);
        output.ProcessPixelRows(accessor =>
        {
            for (var yy = 0; yy < outH; yy++)
            {
                var row = accessor.GetRowSpan(yy);
                for (var xx = leftW; xx < leftW + dividerW; xx++)
                {
                    row[xx] = white;
                }
            }
        });

        await SaveImageWithSafeTempAsync(output, outAbsolutePath, ct);

        var createdAt = DateTimeOffset.UtcNow;
        await AppendCompositeAsync(
            compositesPath,
            compositesLock,
            new CompositeHistoryItem("split", createdAt, relPath, new[] { storedNameA, storedNameB }),
            ct);

        return Results.Ok(new { ok = true, kind = "split", createdAt, relativePath = relPath });
    }
    catch (Exception ex)
    {
        return Results.BadRequest(new { error = ex.Message });
    }
})
.DisableAntiforgery()
.Accepts<SplitRequest>("application/json")
.Produces(StatusCodes.Status200OK)
.Produces(StatusCodes.Status400BadRequest);

app.MapPost("/split3", async Task<IResult> (Split3Request req, CancellationToken ct) =>
{
    await PruneExpiredAsync(ct);

    if (string.IsNullOrWhiteSpace(req.StoredNameA)
        || string.IsNullOrWhiteSpace(req.StoredNameB)
        || string.IsNullOrWhiteSpace(req.StoredNameC))
    {
        return Results.BadRequest(new { error = "storedNameA, storedNameB and storedNameC are required" });
    }

    // sanitize
    var storedNameA = Path.GetFileName(req.StoredNameA);
    var storedNameB = Path.GetFileName(req.StoredNameB);
    var storedNameC = Path.GetFileName(req.StoredNameC);
    if (!string.Equals(storedNameA, req.StoredNameA, StringComparison.Ordinal)
        || !string.Equals(storedNameB, req.StoredNameB, StringComparison.Ordinal)
        || !string.Equals(storedNameC, req.StoredNameC, StringComparison.Ordinal))
    {
        return Results.BadRequest(new { error = "invalid storedName" });
    }

    // split3 uses the current originals (upload/*). This avoids requiring pre-generated resized images.
    // NOTE: this reflects the current state (after crop, upload/<storedName> is updated).
    var srcA = Path.Combine(uploadDir, storedNameA);
    var srcB = Path.Combine(uploadDir, storedNameB);
    var srcC = Path.Combine(uploadDir, storedNameC);
    if (!File.Exists(srcA) || !File.Exists(srcB) || !File.Exists(srcC))
    {
        return Results.BadRequest(new { error = "original file not found" });
    }

    var infoA = await TryGetImageInfoAsync(srcA, ct);
    var infoB = await TryGetImageInfoAsync(srcB, ct);
    var infoC = await TryGetImageInfoAsync(srcC, ct);
    if (infoA.Width <= 0 || infoA.Height <= 0
        || infoB.Width <= 0 || infoB.Height <= 0
        || infoC.Width <= 0 || infoC.Height <= 0)
    {
        return Results.BadRequest(new { error = "file is not a supported image" });
    }

    const int outW = 1280;
    const int outH = 720;
    const int dividerW = 7;
    var panelW = (outW - (dividerW * 2)) / 3; // (1280 - 14) / 3 = 422

    var outFileName = MakeCompositeFileName();
    var outAbsolutePath = Path.Combine(split3Dir, outFileName);
    var relPath = $"split3/{outFileName}";

    try
    {
        using var p1 = new Image<SixLabors.ImageSharp.PixelFormats.Rgba32>(panelW, outH, new SixLabors.ImageSharp.PixelFormats.Rgba32(0, 0, 0, 255));
        using var p2 = new Image<SixLabors.ImageSharp.PixelFormats.Rgba32>(panelW, outH, new SixLabors.ImageSharp.PixelFormats.Rgba32(0, 0, 0, 255));
        using var p3 = new Image<SixLabors.ImageSharp.PixelFormats.Rgba32>(panelW, outH, new SixLabors.ImageSharp.PixelFormats.Rgba32(0, 0, 0, 255));

        static (int x, int y, int w, int h) MapRect(SplitViewRect r, int outPanelW, int outH)
        {
            var vw = r.ViewW <= 0 ? 1 : r.ViewW;
            var vh = r.ViewH <= 0 ? 1 : r.ViewH;
            var sx = outPanelW / vw;
            var sy = outH / vh;

            var x = (int)Math.Round(r.X * sx);
            var y = (int)Math.Round(r.Y * sy);
            var w = (int)Math.Round(r.W * sx);
            var h = (int)Math.Round(r.H * sy);
            return (x, y, Math.Max(1, w), Math.Max(1, h));
        }

        static async Task DrawAsync(Image<SixLabors.ImageSharp.PixelFormats.Rgba32> canvas, string srcPath, SplitViewRect r, int outPanelW, int outH, CancellationToken ct)
        {
            var (x, y, w, h) = MapRect(r, outPanelW, outH);
            await using var input = File.OpenRead(srcPath);
            using var img = await Image.LoadAsync<SixLabors.ImageSharp.PixelFormats.Rgba32>(input, ct);
            img.Mutate(p => p.Resize(w, h));
            canvas.Mutate(p => p.DrawImage(img, new Point(x, y), 1f));
        }

        await DrawAsync(p1, srcA, req.A, panelW, outH, ct);
        await DrawAsync(p2, srcB, req.B, panelW, outH, ct);
        await DrawAsync(p3, srcC, req.C, panelW, outH, ct);

        using var output = new Image<SixLabors.ImageSharp.PixelFormats.Rgba32>(outW, outH, new SixLabors.ImageSharp.PixelFormats.Rgba32(0, 0, 0, 255));
        output.Mutate(p =>
        {
            p.DrawImage(p1, new Point(0, 0), 1f);
            p.DrawImage(p2, new Point(panelW + dividerW, 0), 1f);
            p.DrawImage(p3, new Point((panelW + dividerW) * 2, 0), 1f);
        });

        // White dividers (2 x 7px)
        var white = new SixLabors.ImageSharp.PixelFormats.Rgba32(255, 255, 255, 255);
        var x1 = panelW;
        var x2 = panelW + dividerW + panelW;
        output.ProcessPixelRows(accessor =>
        {
            for (var yy = 0; yy < outH; yy++)
            {
                var row = accessor.GetRowSpan(yy);
                for (var xx = x1; xx < x1 + dividerW; xx++)
                {
                    row[xx] = white;
                }
                for (var xx = x2; xx < x2 + dividerW; xx++)
                {
                    row[xx] = white;
                }
            }
        });

        await SaveImageWithSafeTempAsync(output, outAbsolutePath, ct);

        var createdAt = DateTimeOffset.UtcNow;
        await AppendCompositeAsync(
            compositesPath,
            compositesLock,
            new CompositeHistoryItem("split3", createdAt, relPath, new[] { storedNameA, storedNameB, storedNameC }),
            ct);

        return Results.Ok(new { ok = true, kind = "split3", createdAt, relativePath = relPath });
    }
    catch (Exception ex)
    {
        return Results.BadRequest(new { error = ex.Message });
    }
})
.DisableAntiforgery()
.Accepts<Split3Request>("application/json")
.Produces(StatusCodes.Status200OK)
.Produces(StatusCodes.Status400BadRequest);

app.MapPost("/crop", async Task<IResult> (CropRequest req, CancellationToken ct) =>
{
    await PruneExpiredAsync(ct);
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

    var outAbsolutePath = Path.Combine(uploadDir, storedName);
    if (!File.Exists(outAbsolutePath))
    {
        return Results.NotFound(new { error = "original file not found" });
    }

    // Всегда пытаемся резать от неизменённого исходника (upload-original/...).
    // Для старых записей (до введения upload-original) создаём эту копию перед тем, как перезаписать upload/.
    var sourceAbsolutePath = Path.Combine(uploadOriginalDir, storedName);
    if (!File.Exists(sourceAbsolutePath))
    {
        try
        {
            // This preserves the pre-crop state for legacy items.
            File.Copy(outAbsolutePath, sourceAbsolutePath);
        }
        catch
        {
            // ignore (we'll fallback)
        }
    }

    if (!File.Exists(sourceAbsolutePath))
    {
        // Fallback (если копию не удалось создать или storage read-only)
        sourceAbsolutePath = outAbsolutePath;
    }

    // Загружаем изображение
    Image image;
    await using (var input = new FileStream(sourceAbsolutePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
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

        // Переклэмпим после расчёта
        if (x + w > imgW) w = imgW - x;
        if (y + h > imgH) h = imgH - y;

        image.Mutate(ctx => ctx.Crop(new Rectangle(x, y, w, h)));

        // Сохраняем результат в upload/<storedName> (атомарно)
        await SaveImageWithSafeTempAsync(image, outAbsolutePath, ct);

        // Пересоздаём preview
        var previewAbsolutePath = Path.Combine(previewDir, storedName);
        await CreatePreviewImageAsync(outAbsolutePath, previewAbsolutePath, PreviewWidthPx, ct);

        // Удаляем все ресайзы, т.к. они больше не соответствуют новому оригиналу
        foreach (var rw in resizeWidths)
        {
            TryDeleteFile(Path.Combine(resizedDir, rw.ToString(), storedName));
        }

        // Удаляем старые split/split3 + composites, созданные из этого изображения.
        TryDeleteFile(Path.Combine(splitDir, GetSplitFileName(storedName)));
        TryDeleteFile(Path.Combine(split3Dir, GetSplit3FileName(storedName)));
        DeleteCompositesForStoredName(storedName);

        // Обновляем историю: размеры и сброс resized
        await UpdateHistoryAfterCropAsync(historyPath, historyLock, storedName, w, h, ct);

        return Results.Ok(new
        {
            ok = true,
            storedName,
            imageWidth = w,
            imageHeight = h,
            previewRelativePath = $"preview/{storedName}",
            originalRelativePath = $"upload/{storedName}",
            originalSourceRelativePath = $"upload-original/{storedName}"
        });
    }
})
.DisableAntiforgery()
.Accepts<CropRequest>("application/json")
.Produces(StatusCodes.Status200OK)
.Produces(StatusCodes.Status400BadRequest)
.Produces(StatusCodes.Status404NotFound);

app.MapPost("/trashimg", async Task<IResult> (WindowCropRequest req, CancellationToken ct) =>
{
    await PruneExpiredAsync(ct);

    if (string.IsNullOrWhiteSpace(req.StoredName))
    {
        return Results.BadRequest(new { error = "storedName is required" });
    }

    var storedName = Path.GetFileName(req.StoredName);
    if (!string.Equals(storedName, req.StoredName, StringComparison.Ordinal))
    {
        return Results.BadRequest(new { error = "invalid storedName" });
    }

    var originalPath = Path.Combine(uploadDir, storedName);
    if (!File.Exists(originalPath))
    {
        return Results.NotFound(new { error = "original file not found" });
    }

    try
    {
        // 1) Кадр: режем исходник по прямоугольнику из UI (в координатах оригинала).
        using var src = await Image.LoadAsync<SixLabors.ImageSharp.PixelFormats.Rgba32>(originalPath, ct);

        var imgW = src.Width;
        var imgH = src.Height;
        if (imgW <= 0 || imgH <= 0)
        {
            return Results.BadRequest(new { error = "invalid image" });
        }

        var x = (int)Math.Round(req.X);
        var y = (int)Math.Round(req.Y);
        var w = (int)Math.Round(req.W);
        var h = (int)Math.Round(req.H);

        if (w <= 0 || h <= 0)
        {
            return Results.BadRequest(new { error = "invalid crop rect" });
        }

        if (x < 0) x = 0;
        if (y < 0) y = 0;
        if (x >= imgW) x = imgW - 1;
        if (y >= imgH) y = imgH - 1;

        if (x + w > imgW) w = imgW - x;
        if (y + h > imgH) h = imgH - y;

        if (w <= 0 || h <= 0)
        {
            return Results.BadRequest(new { error = "empty crop after clamp" });
        }

        using var cropped = src.Clone(ctx => ctx.Crop(new Rectangle(x, y, w, h)));

        // 2) Готовим полотно под PNG-шаблон.
        SixLabors.ImageSharp.Image<SixLabors.ImageSharp.PixelFormats.Rgba32>? baseOverlay = null;
        int outW;
        int outH;

        if (File.Exists(trashOverlayPath))
        {
            baseOverlay = await Image.LoadAsync<SixLabors.ImageSharp.PixelFormats.Rgba32>(trashOverlayPath, ct);
            outW = baseOverlay.Width;
            outH = baseOverlay.Height;
        }
        else
        {
            // Fallback: если PNG исчез — рендерим простую карточку 1920x1080.
            outW = 1920;
            outH = 1080;
        }

        // Область, в которую должен вписаться кадр внутри шаблона — внутреннее окно PNG.
        // Координаты окна заданы в пикселях для исходного PNG 1920x1080:
        // windowX = 593, windowY = 79, windowW = 735, windowH = 922.
        const double templateW = 1920.0;
        const double templateH = 1080.0;
        const double windowPxX = 593.0;
        const double windowPxY = 79.0;
        const double windowPxW = 735.0;
        const double windowPxH = 922.0;

        // Масштабируем геометрию окна под фактический размер PNG (outW/outH).
        var scaleX = outW / templateW;
        var scaleY = outH / templateH;
        var k = (scaleX + scaleY) / 2.0;

        var winX = windowPxX * k;
        var winY = windowPxY * k;
        var winW = windowPxW * k;
        var winH = windowPxH * k;

        // Масштабируем кроп так, чтобы он заполнил окно без искажений.
        var scaleToHeight = winH / h;
        var scaleToWidth = winW / w;
        var scaleCrop = (scaleToHeight + scaleToWidth) / 2.0;

        var targetW = (int)Math.Round(w * scaleCrop);
        var targetH = (int)Math.Round(h * scaleCrop);

        // Если после округления отличия от окна маленькие — приравниваем к размеру окна.
        if (Math.Abs(targetW - winW) <= 2 && Math.Abs(targetH - winH) <= 2)
        {
            targetW = (int)Math.Round(winW);
            targetH = (int)Math.Round(winH);
        }

        if (targetW < 1) targetW = 1;
        if (targetH < 1) targetH = 1;

        cropped.Mutate(p => p.Resize(targetW, targetH));

        var bgColor = new SixLabors.ImageSharp.PixelFormats.Rgba32(243, 244, 246, 255);
        using var output = new Image<SixLabors.ImageSharp.PixelFormats.Rgba32>(outW, outH, bgColor);

        // Выравниваем отмасштабированный кадр по окну внутри PNG.
        var dstX = (int)Math.Round(winX + (winW - targetW) / 2.0);
        var dstY = (int)Math.Round(winY + (winH - targetH) / 2.0);

        // Сначала рисуем кропнутую картинку, затем поверх неё — PNG-шаблон
        output.Mutate(p => p.DrawImage(cropped, new Point(dstX, dstY), 1f));

        if (baseOverlay != null)
        {
            output.Mutate(p => p.DrawImage(baseOverlay, new Point(0, 0), 1f));
            baseOverlay.Dispose();
        }

        var fileName = MakeCompositeFileName();
        var outAbsolutePath = Path.Combine(trashDir, fileName);
        var relPath = $"trashimg/{fileName}";

        await SaveImageWithSafeTempAsync(output, outAbsolutePath, ct);

        var createdAt = DateTimeOffset.UtcNow;
        await AppendCompositeAsync(
            compositesPath,
            compositesLock,
            new CompositeHistoryItem("trashimg", createdAt, relPath, new[] { storedName }),
            ct);

        return Results.Ok(new { ok = true, kind = "trashimg", createdAt, relativePath = relPath });
    }
    catch (Exception ex)
    {
        return Results.BadRequest(new { error = ex.Message });
    }
})
.DisableAntiforgery()
.Accepts<WindowCropRequest>("application/json")
.Produces(StatusCodes.Status200OK)
.Produces(StatusCodes.Status400BadRequest)
.Produces(StatusCodes.Status404NotFound);

app.MapPost("/oknoscale", async Task<IResult> (WindowCropRequest req, CancellationToken ct) =>
{
    await PruneExpiredAsync(ct);

    if (string.IsNullOrWhiteSpace(req.StoredName))
    {
        return Results.BadRequest(new { error = "storedName is required" });
    }

    var storedName = Path.GetFileName(req.StoredName);
    if (!string.Equals(storedName, req.StoredName, StringComparison.Ordinal))
    {
        return Results.BadRequest(new { error = "invalid storedName" });
    }

    var originalPath = Path.Combine(uploadDir, storedName);
    if (!File.Exists(originalPath))
    {
        return Results.NotFound(new { error = "original file not found" });
    }

    try
    {
        using var src = await Image.LoadAsync<SixLabors.ImageSharp.PixelFormats.Rgba32>(originalPath, ct);

        var imgW = src.Width;
        var imgH = src.Height;
        if (imgW <= 0 || imgH <= 0)
        {
            return Results.BadRequest(new { error = "invalid image" });
        }

        var x = (int)Math.Round(req.X);
        var y = (int)Math.Round(req.Y);
        var w = (int)Math.Round(req.W);
        var h = (int)Math.Round(req.H);

        if (w <= 0 || h <= 0)
        {
            return Results.BadRequest(new { error = "invalid crop rect" });
        }

        if (x < 0) x = 0;
        if (y < 0) y = 0;
        if (x >= imgW) x = imgW - 1;
        if (y >= imgH) y = imgH - 1;

        if (x + w > imgW) w = imgW - x;
        if (y + h > imgH) h = imgH - y;

        if (w <= 0 || h <= 0)
        {
            return Results.BadRequest(new { error = "empty crop after clamp" });
        }

        using var cropped = src.Clone(ctx => ctx.Crop(new Rectangle(x, y, w, h)));

        const int outW = 1920;
        const int outH = 1080;

        // Масштабируем кроп в центральное окно с однотонным фоном.
        var bgColor = new SixLabors.ImageSharp.PixelFormats.Rgba32(243, 244, 246, 255);
        using var output = new Image<SixLabors.ImageSharp.PixelFormats.Rgba32>(outW, outH, bgColor);

        // Максимальный размер центрального окна ~90% от кадра, без искажений.
        var maxContentW = outW * 0.9;
        var maxContentH = outH * 0.9;
        var scaleToW = maxContentW / w;
        var scaleToH = maxContentH / h;
        var scale = Math.Min(scaleToW, scaleToH);
        if (scale <= 0) scale = 1;

        var targetW = (int)Math.Round(w * scale);
        var targetH = (int)Math.Round(h * scale);
        if (targetW < 1) targetW = 1;
        if (targetH < 1) targetH = 1;

        cropped.Mutate(p => p.Resize(targetW, targetH));

        var dstX = (outW - targetW) / 2;
        var dstY = (outH - targetH) / 2;

        // Рисуем кроп по центру
        output.Mutate(p => p.DrawImage(cropped, new Point(dstX, dstY), 1f));

        // Скругляем только углы центрального окна (там, где лежит картинка), а не всю карточку.
        const int baseCornerRadius = 8; // ещё в ~2 раза меньше
        var r = Math.Min(baseCornerRadius, Math.Min(targetW, targetH) / 2);
        var r2 = r * r;

        var left = dstX;
        var right = dstX + targetW - 1;
        var top = dstY;
        var bottom = dstY + targetH - 1;
        var cxLeft = left + r;
        var cxRight = right - r;
        var cyTop = top + r;
        var cyBottom = bottom - r;

        output.ProcessPixelRows(accessor =>
        {
            for (var yy = top; yy <= bottom; yy++)
            {
                var row = accessor.GetRowSpan(yy);
                for (var xx = left; xx <= right; xx++)
                {
                    bool outside = false;

                    if (xx < cxLeft && yy < cyTop)
                    {
                        var dx = cxLeft - xx;
                        var dy = cyTop - yy;
                        outside = dx * dx + dy * dy > r2;
                    }
                    else if (xx > cxRight && yy < cyTop)
                    {
                        var dx = xx - cxRight;
                        var dy = cyTop - yy;
                        outside = dx * dx + dy * dy > r2;
                    }
                    else if (xx < cxLeft && yy > cyBottom)
                    {
                        var dx = cxLeft - xx;
                        var dy = yy - cyBottom;
                        outside = dx * dx + dy * dy > r2;
                    }
                    else if (xx > cxRight && yy > cyBottom)
                    {
                        var dx = xx - cxRight;
                        var dy = yy - cyBottom;
                        outside = dx * dx + dy * dy > r2;
                    }

                    if (outside)
                    {
                        // Затираем угол обратно цветом фона, чтобы углы картинки стали визуально скруглёнными.
                        row[xx] = bgColor;
                    }
                }
            }
        });

        // PNG, чтобы сохранить аккуратные края центрального окна.
        var createdAt = DateTimeOffset.UtcNow;
        var fileName = $"{createdAt:yyyyMMdd-HHmmss-fff}-{Guid.NewGuid():N}.png";
        var outAbsolutePath = Path.Combine(trashDir, fileName);
        var relPath = $"trashimg/{fileName}";

        await SaveImageWithSafeTempAsync(output, outAbsolutePath, ct);

        await AppendCompositeAsync(
            compositesPath,
            compositesLock,
            new CompositeHistoryItem("oknoscale", createdAt, relPath, new[] { storedName }),
            ct);

        return Results.Ok(new { ok = true, kind = "oknoscale", createdAt, relativePath = relPath });
    }
    catch (Exception ex)
    {
        return Results.BadRequest(new { error = ex.Message });
    }
})
.DisableAntiforgery()
.Accepts<WindowCropRequest>("application/json")
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

static async Task<List<CompositeHistoryItem>> ReadCompositesAsync(string compositesPath, SemaphoreSlim compositesLock, CancellationToken ct)
{
    await compositesLock.WaitAsync(ct);
    try
    {
        if (!File.Exists(compositesPath))
        {
            return new List<CompositeHistoryItem>();
        }

        var json = await File.ReadAllTextAsync(compositesPath, ct);
        if (string.IsNullOrWhiteSpace(json))
        {
            return new List<CompositeHistoryItem>();
        }

        return JsonSerializer.Deserialize<List<CompositeHistoryItem>>(json) ?? new List<CompositeHistoryItem>();
    }
    catch
    {
        return new List<CompositeHistoryItem>();
    }
    finally
    {
        compositesLock.Release();
    }
}

static async Task WriteCompositesAsync(string compositesPath, SemaphoreSlim compositesLock, List<CompositeHistoryItem> items, CancellationToken ct)
{
    await compositesLock.WaitAsync(ct);
    try
    {
        var json = JsonSerializer.Serialize(items, new JsonSerializerOptions { WriteIndented = true });
        await File.WriteAllTextAsync(compositesPath, json, ct);
    }
    finally
    {
        compositesLock.Release();
    }
}

static async Task AppendCompositeAsync(string compositesPath, SemaphoreSlim compositesLock, CompositeHistoryItem entry, CancellationToken ct)
{
    var items = await ReadCompositesAsync(compositesPath, compositesLock, ct);
    items.Add(entry);
    await WriteCompositesAsync(compositesPath, compositesLock, items, ct);
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
record SplitViewRect(double X, double Y, double W, double H, double ViewW, double ViewH);
record SplitRequest(
    string StoredNameA,
    string StoredNameB,
    SplitViewRect A,
    SplitViewRect B
);
record Split3Request(
    string StoredNameA,
    string StoredNameB,
    string StoredNameC,
    SplitViewRect A,
    SplitViewRect B,
    SplitViewRect C
);
record WindowCropRequest(
    string StoredName,
    double X,
    double Y,
    double W,
    double H
);
record CompositeHistoryItem(
    string Kind,
    DateTimeOffset CreatedAt,
    string RelativePath,
    string[] Sources
);
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

record CompositeDeleteRequest(string RelativePath);
