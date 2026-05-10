#!/usr/bin/env bash
set -u
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

IP="${V2H_IP_ADDRESS:-}"
TIMEOUT_MS="3000"
INTERVAL_MS="100"
PROBE_CONNECTION="false"
PROBE_DELAY_MS="3000"
LOG_DIR="${V2H_LOG_DIR:-${HOME}/v2h-logs}"

usage() {
  cat <<'USAGE'
Usage:
  raspi-status-check.sh --ip <V2H_IP_ADDRESS> [--timeout <ms>] [--interval <ms>] [--probe-connection] [--probe-delay <ms>] [--log-dir <dir>]

Defaults:
  --timeout 3000
  --interval 100
  --probe-delay 3000

Environment variables:
  V2H_IP_ADDRESS  Default IP address when --ip is omitted.
  V2H_LOG_DIR     Default log directory. Defaults to ~/v2h-logs.

This script only reads V2H status. It does not send control SetC commands.
When --probe-connection is specified, it sends one vehicle connection check
SetC (EPC 0xCD=0x10), not a charge/discharge command.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --ip)
      if [ "$#" -lt 2 ]; then
        echo "Missing value for --ip" >&2
        usage >&2
        exit 2
      fi
      IP="$2"
      shift 2
      ;;
    --timeout)
      if [ "$#" -lt 2 ]; then
        echo "Missing value for --timeout" >&2
        usage >&2
        exit 2
      fi
      TIMEOUT_MS="$2"
      shift 2
      ;;
    --interval)
      if [ "$#" -lt 2 ]; then
        echo "Missing value for --interval" >&2
        usage >&2
        exit 2
      fi
      INTERVAL_MS="$2"
      shift 2
      ;;
    --probe-connection)
      PROBE_CONNECTION="true"
      shift
      ;;
    --probe-delay)
      if [ "$#" -lt 2 ]; then
        echo "Missing value for --probe-delay" >&2
        usage >&2
        exit 2
      fi
      PROBE_DELAY_MS="$2"
      shift 2
      ;;
    --log-dir)
      if [ "$#" -lt 2 ]; then
        echo "Missing value for --log-dir" >&2
        usage >&2
        exit 2
      fi
      LOG_DIR="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "$IP" ]; then
  echo "V2H IP address is required. Pass --ip or set V2H_IP_ADDRESS." >&2
  usage >&2
  exit 2
fi

if command -v v2h >/dev/null 2>&1; then
  V2H_CMD=(v2h)
elif [ -f "${PROJECT_ROOT}/cli.js" ]; then
  V2H_CMD=(node "${PROJECT_ROOT}/cli.js")
else
  echo "v2h command was not found, and ${PROJECT_ROOT}/cli.js is missing." >&2
  exit 127
fi

mkdir -p "$LOG_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="${LOG_DIR}/v2h-status-${STAMP}.log"

{
  echo "timestamp=$(date --iso-8601=seconds 2>/dev/null || date)"
  echo "host=$(hostname)"
  echo "ip=${IP}"
  echo "timeout_ms=${TIMEOUT_MS}"
  echo "interval_ms=${INTERVAL_MS}"
  echo "probe_connection=${PROBE_CONNECTION}"
  echo "probe_delay_ms=${PROBE_DELAY_MS}"
  echo "v2h_cmd=${V2H_CMD[*]}"
  echo
  echo "== v2h status =="
  status_args=(--ip "$IP" --timeout "$TIMEOUT_MS" --interval "$INTERVAL_MS")
  if [ "$PROBE_CONNECTION" = "true" ]; then
    status_args+=(--probe-connection --probe-delay "$PROBE_DELAY_MS")
  fi
  "${V2H_CMD[@]}" status "${status_args[@]}"
  echo
  echo "== v2h control-status =="
  control_status_args=(--ip "$IP" --timeout "$TIMEOUT_MS" --interval "$INTERVAL_MS")
  if [ "$PROBE_CONNECTION" = "true" ]; then
    control_status_args+=(--probe-connection --probe-delay "$PROBE_DELAY_MS")
  fi
  "${V2H_CMD[@]}" control-status "${control_status_args[@]}"
} 2>&1 | tee "$LOG_FILE"

RESULT=${PIPESTATUS[0]}
echo "log_file=${LOG_FILE}"
exit "$RESULT"
