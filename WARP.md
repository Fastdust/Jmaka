# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Current state (2025-12-17)
- Приложение: Jmaka
- Версия: 0.1.4
- ASP.NET Core Minimal API находится в `src/Jmaka.Api/`.

## Repository structure
- `Jmaka.slnx`: solution-файл.
- `src/Jmaka.Api/`: ASP.NET Core Web API (Minimal API).
  - `Program.cs`: endpoints, лимиты, раздача статики и runtime-файлов.
  - `wwwroot/`: веб-интерфейс (таблица истории, ресайзы, удаление, crop).
- `deploy/`: скрипты публикации/установки (Ubuntu 24).

## Commands (PowerShell)
Сборка:
- `dotnet build Jmaka.slnx -c Release`

Запуск локально:
- `dotnet run --project src/Jmaka.Api --launch-profile http`

Публикация под Linux (для сервера):
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy\publish-linux.ps1`

## Runtime storage
По умолчанию runtime-данные (upload/resized/preview/data) создаются рядом с приложением (ContentRootPath).
Для деплоя можно вынести их через переменную окружения:
- `JMAKA_STORAGE_ROOT=/var/www/jmaka/<instance>/storage`

## API endpoints
- `POST /upload` (multipart/form-data поле `file`)
  - сохраняет оригинал в `upload/{storedName}` (storedName = uuid + ext)
  - для изображений создаёт миниатюру `preview/{storedName}` и пишет запись в историю
- `GET /history` — общая история (последние 200)
- `POST /resize` (JSON `{ storedName, width }`)
  - создаёт `resized/{width}/{storedName}` (апскейл запрещён)
  - обновляет историю (`resized[width] = relativePath`)
- `POST /delete` (JSON `{ storedName }`)
  - удаляет запись истории и все связанные файлы (upload/preview/resized)
- `POST /crop` (JSON `{ storedName, x, y, width, height }`)
  - обрезает оригинал, пересоздаёт preview, удаляет все resized и сбрасывает resized в истории

## Known issue (Windows build file lock)
Иногда `dotnet build -c Release` падает, если запущен `Jmaka.Api.exe` из `bin/Release` (файл блокируется).
Решение: остановить процесс (taskkill) или не держать запущенный Release-вывод во время сборки.
