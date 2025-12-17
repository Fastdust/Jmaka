# Jmaka

Версия: 0.1.0b

Небольшое веб-приложение на ASP.NET Core (Minimal API) для загрузки файлов и обработки изображений.

## Возможности
- загрузка файлов (лимит 75 MB, серверное имя = UUID)
- для изображений:
  - миниатюры превью (`/preview/*`), чтобы не грузить оригиналы
  - история загрузок общая для всех пользователей (`/history`)
  - ресайз по фиксированным ширинам (720/1080/1260/1920/2440) по запросу (`/resize`), апскейл запрещён
  - удаление записи из истории и всех связанных файлов (`/delete`)
  - кадрирование (crop) с фиксированным соотношением 16:9 через UI, сохраняет результат в оригинал и сбрасывает ресайзы (`/crop`)

## Запуск локально
- `dotnet run --project src/Jmaka.Api --launch-profile http`
- открыть `http://localhost:5189/`

## API (кратко)
- `POST /upload` (multipart/form-data поле `file`)
- `POST /resize` (JSON `{ storedName, width }`)
- `POST /crop` (JSON `{ storedName, x, y, width, height }`)
- `GET /history`
- `POST /delete` (JSON `{ storedName }`)

## Деплой на Ubuntu 24 (максимально просто)
Нужно: VPS с Ubuntu 24 + установленный nginx (как reverse-proxy).

### Шаг 1 — собрать архив под Linux (на Windows)
Из корня репозитория:
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy\publish-linux.ps1`

Результат: `artifacts/jmaka-linux-x64.tar.gz`

### Шаг 2 — загрузить архив на сервер
Рекомендуемая папка:
- `/var/www/jmaka/_bundles/`

### Шаг 3 — установить/обновить инстанс (мастер)
На сервере (в папке репозитория):
- `sudo bash deploy/ubuntu24/install.sh`

Скрипт задаст вопросы и:
- разложит файлы в `/var/www/jmaka/<name>/app`
- создаст storage в `/var/www/jmaka/<name>/storage`
- создаст systemd сервис `jmaka-<name>` на `127.0.0.1:<port>`
- по выбору: распечатает конфиг nginx или создаст файл в `/etc/nginx/...`

### Два сценария подключения к домену
1) Отдельный домен/поддомен целиком под Jmaka (root `/`)
- выбирайте path prefix `/`
- nginx проксирует `location /` на `127.0.0.1:<port>`

2) Подключение к существующему домену в подпапку (например `/jmaka/`)
- выбирайте path prefix `/jmaka/`
- приложение автоматически включает base-path через `JMAKA_BASE_PATH=/jmaka`
- nginx должен иметь `location /jmaka/ { proxy_pass http://127.0.0.1:<port>; }`
  (важно: БЕЗ слэша в конце proxy_pass, чтобы префикс /jmaka/ дошёл до приложения)

### Полезные команды на сервере
Статус и логи:
- `systemctl status jmaka-<name> --no-pager`
- `journalctl -u jmaka-<name> -n 200 --no-pager`

Проверка nginx:
- `nginx -t && systemctl reload nginx`

### Переменные окружения
- `JMAKA_STORAGE_ROOT` — куда писать upload/resized/preview/data (скрипт ставит в `/var/www/jmaka/<name>/storage`)
- `JMAKA_BASE_PATH` — base-path для подпапки (например `/jmaka`), `/` = корень

## Известная особенность (Windows)
Если `dotnet build -c Release` падает с ошибкой, что файл `Jmaka.Api.exe` занят — значит запущен процесс из `bin/Release`. Остановите его и пересоберите.
