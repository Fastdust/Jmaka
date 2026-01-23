#!/usr/bin/env bash
set -euo pipefail

# Jmaka instance updater (Ubuntu 24)
#
# Что делает:
# - находит все systemd-сервисы jmaka-*.service
# - для каждого читает порт (ASPNETCORE_URLS), base-path (JMAKA_BASE_PATH), путь к app/ и версию из index.html
# - интерактивно позволяет выбрать, какой(ие) инстанс(ы) обновить
# - берёт новый jmaka-*.tar.gz, переливает его в app/, делает бэкап старого app и перезапускает сервисы
#
# Использование (рекомендуется):
#   sudo bash deploy/ubuntu24/update-instance.sh
#

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "This updater needs sudo. Re-run with sudo..." >&2
  exec sudo -E JMAKA_ORIG_USER="${USER:-}" JMAKA_ORIG_HOME="${HOME:-}" bash "$0" "$@"
fi

echo "=== Jmaka updater (instances via systemd jmaka-*.service) ==="

# Find all jmaka-*.service units via systemd (handles escaped names like jmaka\x2djmaka)
mapfile -t UNIT_NAMES < <(systemctl list-unit-files 'jmaka-*' --no-legend 2>/dev/null | awk '{print $1}' | grep '\.service$' || true)

if [[ ${#UNIT_NAMES[@]} -eq 0 ]]; then
  echo "No Jmaka instances found (jmaka-*.service in systemd)." >&2
  exit 1
fi

INSTANCE_NAMES=()
INSTANCE_APPDIRS=()
INSTANCE_PORTS=()
INSTANCE_BASEPATHS=()
INSTANCE_VERSIONS=()

for svc_name in "${UNIT_NAMES[@]}"; do
  # Resolve actual unit file path on disk (FragmentPath)
  uf="$(systemctl show -p FragmentPath --value "$svc_name" 2>/dev/null || true)"
  if [[ -z "$uf" || ! -f "$uf" ]]; then
    continue
  fi

  # Read Environment= lines from the unit file
  env_lines="$(grep -E '^Environment=' "$uf" || true)"

  # Extract JMAKA_STORAGE_ROOT value (optionally quoted)
  storage_root_line="$(printf '%s\n' "$env_lines" | grep -m1 'JMAKA_STORAGE_ROOT=' || true)"
  storage_root="${storage_root_line#*JMAKA_STORAGE_ROOT=}"
  storage_root="${storage_root%\"}"
  storage_root="${storage_root#\"}"

  base_dir=""
  if [[ -n "$storage_root" ]]; then
    base_dir="$(dirname "$storage_root")"   # /var/www/jmaka/<name>
  fi

  app_dir=""
  if [[ -n "$base_dir" ]]; then
    app_dir="${base_dir%/}/app"
  fi

  # Extract ASPNETCORE_URLS value (optionally quoted), then pull out the port
  asp_urls_line="$(printf '%s\n' "$env_lines" | grep -m1 'ASPNETCORE_URLS=' || true)"
  asp_urls="${asp_urls_line#*ASPNETCORE_URLS=}"
  asp_urls="${asp_urls%\"}"
  asp_urls="${asp_urls#\"}"
  # Expect something like http://127.0.0.1:5000
  port="$(printf '%s\n' "$asp_urls" | sed -E 's@.*:([0-9]+)$@\1@')"

  # Extract JMAKA_BASE_PATH value (optionally quoted)
  base_path_line="$(printf '%s\n' "$env_lines" | grep -m1 'JMAKA_BASE_PATH=' || true)"
  base_path="${base_path_line#*JMAKA_BASE_PATH=}"
  base_path="${base_path%\"}"
  base_path="${base_path#\"}"
  [[ -z "$base_path" ]] && base_path="/"

  # Detect version from index.html inside app/wwwroot
  version="unknown"
  if [[ -n "$app_dir" && -f "$app_dir/wwwroot/index.html" ]]; then
    ver_line="$(grep -m1 'Jmaka ' "$app_dir/wwwroot/index.html" || true)"
    if [[ -n "$ver_line" ]]; then
      v="$(printf '%s\n' "$ver_line" | grep -o 'Jmaka [0-9.]\+' || true)"
      v="${v#Jmaka }"
      [[ -n "$v" ]] && version="$v"
    fi
  fi

  INSTANCE_NAMES+=("$svc_name")
  INSTANCE_APPDIRS+=("$app_dir")
  INSTANCE_PORTS+=("$port")
  INSTANCE_BASEPATHS+=("$base_path")
  INSTANCE_VERSIONS+=("$version")
done

echo "Detected instances:"
for i in "${!INSTANCE_NAMES[@]}"; do
  idx=$((i+1))
  printf " [%d] service='%s', appDir='%s', port=%s, path='%s', version=%s\n" \
    "$idx" \
    "${INSTANCE_NAMES[$i]}" \
    "${INSTANCE_APPDIRS[$i]}" \
    "${INSTANCE_PORTS[$i]:-?}" \
    "${INSTANCE_BASEPATHS[$i]}" \
    "${INSTANCE_VERSIONS[$i]}"
done

# Choose which instance(s) to update
SELECTED_INDEXES=()
if [[ ${#INSTANCE_NAMES[@]} -eq 1 ]]; then
  read -r -p "Update this single instance? [Y/n]: " ans
  ans="${ans:-Y}"
  if [[ ! "$ans" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
  SELECTED_INDEXES=(0)
else
  echo
  echo "Enter instance number to update (e.g. 1), or 'a' to update ALL."
  read -r -p "Your choice: " choice
  if [[ "$choice" =~ ^[Aa]$ ]]; then
    for i in "${!INSTANCE_NAMES[@]}"; do
      SELECTED_INDEXES+=("$i")
    done
  else
    if ! [[ "$choice" =~ ^[0-9]+$ ]]; then
      echo "Invalid choice." >&2
      exit 1
    fi
    idx=$((choice-1))
    if (( idx < 0 || idx >= ${#INSTANCE_NAMES[@]} )); then
      echo "Invalid index." >&2
      exit 1
    fi
    SELECTED_INDEXES=("$idx")
  fi
fi

# Ask for bundle path
ORIG_USER="${JMAKA_ORIG_USER:-${SUDO_USER:-${USER:-}}}"
ORIG_HOME="${JMAKA_ORIG_HOME:-${HOME:-/root}}"
default_tar="${ORIG_HOME}/jmaka.tar.gz"
read -r -p "Path to new bundle (.tar.gz) [${default_tar}]: " APP_TAR
APP_TAR="${APP_TAR:-$default_tar}"

# Expand ~
if [[ "$APP_TAR" == "~/"* ]]; then
  APP_TAR="${ORIG_HOME}/${APP_TAR#~/}"
fi

if [[ ! -f "$APP_TAR" ]]; then
  echo "Bundle file not found: $APP_TAR" >&2
  exit 1
fi

echo
echo "Using bundle: $APP_TAR"
echo

# Safety: confirm
read -r -p "Proceed with update? [Y/n]: " go
go="${go:-Y}"
if [[ ! "$go" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

for idx in "${SELECTED_INDEXES[@]}"; do
  svc="${INSTANCE_NAMES[$idx]}"
  app_dir="${INSTANCE_APPDIRS[$idx]}"

  if [[ -z "$app_dir" || ! -d "$app_dir" ]]; then
    echo "Skip $svc: appDir not found: $app_dir" >&2
    continue
  fi

  case "$app_dir" in
    /var/www/jmaka/*/app) ;;
    *)
      echo "WARNING: appDir looks suspicious: $app_dir (expected /var/www/jmaka/<name>/app). Skipping." >&2
      continue
      ;;
  esac

  echo "=== Updating instance $svc (appDir=$app_dir) ==="

  systemctl stop "$svc" || true

  backup_dir="${app_dir}.bak-$(date +%Y%m%d-%H%M%S)"
  echo "Creating backup: $backup_dir"
  mkdir -p "$backup_dir"
  rsync -a --delete "$app_dir"/ "$backup_dir"/ || true

  echo "Cleaning appDir..."
  rm -rf "${app_dir:?}/"*

  echo "Extracting bundle..."
  tar -xzf "$APP_TAR" -C "$app_dir"

  echo "Setting permissions..."
  chown -R root:root "$app_dir"
  chmod -R a=rX "$app_dir"

  echo "Starting service $svc ..."
  systemctl start "$svc"
  sleep 2
  systemctl status "$svc" --no-pager || true

  echo "Done for $svc."
  echo
done

echo "All requested instances processed."
