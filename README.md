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

### Вариант A (рекомендуется) — скачать готовый архив из GitHub Releases
Мы прикладываем готовые архивы к релизам и будем делать так всегда.

#### Одна команда: скачать архив + (опционально) распаковать в домашнюю папку + запустить установщик
```bash path=null start=null
curl -L -o ~/jmaka.tar.gz \
  https://github.com/Fastdust/Jmaka-Releases/releases/latest/download/jmaka-linux-x64.tar.gz \
&& mkdir -p ~/jmaka_bundle \
&& tar -xzf ~/jmaka.tar.gz -C ~/jmaka_bundle \
&& curl -L -o ~/jmaka-install.sh \
  https://raw.githubusercontent.com/Fastdust/Jmaka-Releases/main/install.sh \
&& bash ~/jmaka-install.sh --interactive
```

Пояснения:
- `~/jmaka.tar.gz` — архив релиза.
- `~/jmaka_bundle/` — распакованное содержимое архива (для проверки). Установщик всё равно использует tar.gz и сам раскладывает файлы в `/var/www/jmaka/...`.

### Вариант B — собрать архив самому (на Windows)
Из корня репозитория:
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy\publish-linux.ps1`

Результат: `artifacts/jmaka-0.1.0b-linux-x64.tar.gz`

### Установка/обновление инстанса (мастер)
Если репозиторий уже на сервере, можно запускать напрямую:
- `bash deploy/ubuntu24/install.sh`

Или (рекомендуется для “без git”):
- скачать `install.sh` в домашнюю папку и запустить: `bash ~/jmaka-install.sh`

Скрипт сам запросит sudo (если нужно) и по умолчанию возьмёт архив из `~/jmaka.tar.gz`.

Скрипт задаст вопросы и:
- разложит файлы в `/var/www/jmaka/<name>/app`
- создаст storage в `/var/www/jmaka/<name>/storage`
- создаст systemd сервис `jmaka-<name>` на `127.0.0.1:<port>`
- проверит недостающие компоненты (пакеты, runtime)
- покажет занятые порты и предложит первый свободный в диапазоне 5000-5999
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

## Windows (локальные тесты)
### Запуск
- `dotnet run --project src/Jmaka.Api --launch-profile http`
- открыть `http://localhost:5189/`

### Известная особенность (file lock)
Если `dotnet build -c Release` падает с ошибкой, что файл `Jmaka.Api.exe` занят — значит запущен процесс из `bin/Release`. Остановите его и пересоберите.
