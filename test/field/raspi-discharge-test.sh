#!/usr/bin/env bash
set -u
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

IP="${V2H_IP_ADDRESS:-}"
TIMEOUT_MS="3000"
INTERVAL_MS="250"
CONFIRM_DELAY_MS="3000"
PROBE_CONNECTION="false"
PROBE_DELAY_MS="3000"
AFTER_WAIT_SEC="20"
LOG_DIR="${V2H_LOG_DIR:-${HOME}/v2h-logs}"
ACTION="dry-run"

usage() {
  cat <<'USAGE'
Usage:
  raspi-discharge-test.sh --ip <V2H_IP_ADDRESS> [options]

Options:
  --dry-run              Run discharge safety precheck only. Default.
  --execute              Send one discharge SetC after safety precheck passes.
  --standby              Send one standby SetC and read status afterward.
  --ip <address>         V2H IP address.
  --timeout <ms>         Per-request timeout. Default: 3000.
  --interval <ms>        Delay between ECHONET Lite requests. Default: 250.
  --confirm-delay <ms>   Delay before reading back mode after SetC. Default: 3000.
  --probe-connection     Send one vehicle connection check (EPC 0xCD=0x10) before judging safety.
  --probe-delay <ms>     Delay after vehicle connection check. Default: 3000.
  --after-wait <sec>     Wait before final control-status. Default: 20.
  --log-dir <dir>        Log directory. Default: ~/v2h-logs.
  -h, --help             Show this help.

Environment variables:
  V2H_IP_ADDRESS  Default IP address when --ip is omitted.
  V2H_LOG_DIR     Default log directory.

This script is for Raspberry Pi field testing. It writes logs and sends no
control command unless --execute or --standby is specified.
When --probe-connection is specified, it sends one vehicle connection check
SetC (EPC 0xCD=0x10) before reading the connection status.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      ACTION="dry-run"
      shift
      ;;
    --execute)
      ACTION="execute"
      shift
      ;;
    --standby)
      ACTION="standby"
      shift
      ;;
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
    --confirm-delay)
      if [ "$#" -lt 2 ]; then
        echo "Missing value for --confirm-delay" >&2
        usage >&2
        exit 2
      fi
      CONFIRM_DELAY_MS="$2"
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
    --after-wait)
      if [ "$#" -lt 2 ]; then
        echo "Missing value for --after-wait" >&2
        usage >&2
        exit 2
      fi
      AFTER_WAIT_SEC="$2"
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
LOG_FILE="${LOG_DIR}/v2h-discharge-${ACTION}-${STAMP}.log"

common_args=(
  --ip "$IP"
  --timeout "$TIMEOUT_MS"
  --interval "$INTERVAL_MS"
)

control_args=(
  --ip "$IP"
  --timeout "$TIMEOUT_MS"
  --interval "$INTERVAL_MS"
  --confirm-delay "$CONFIRM_DELAY_MS"
)

if [ "$PROBE_CONNECTION" = "true" ]; then
  common_args+=(--probe-connection --probe-delay "$PROBE_DELAY_MS")
  control_args+=(--probe-connection --probe-delay "$PROBE_DELAY_MS")
fi

{
  echo "timestamp=$(date --iso-8601=seconds 2>/dev/null || date)"
  echo "host=$(hostname)"
  echo "action=${ACTION}"
  echo "ip=${IP}"
  echo "timeout_ms=${TIMEOUT_MS}"
  echo "interval_ms=${INTERVAL_MS}"
  echo "confirm_delay_ms=${CONFIRM_DELAY_MS}"
  echo "probe_connection=${PROBE_CONNECTION}"
  echo "probe_delay_ms=${PROBE_DELAY_MS}"
  echo "after_wait_sec=${AFTER_WAIT_SEC}"
  echo "v2h_cmd=${V2H_CMD[*]}"
  echo
  echo "== before control-status =="
  "${V2H_CMD[@]}" control-status "${common_args[@]}"
  echo

  case "$ACTION" in
    dry-run)
      echo "== discharge dry-run =="
      "${V2H_CMD[@]}" control discharge "${control_args[@]}"
      ;;
    execute)
      echo "== discharge execute =="
      "${V2H_CMD[@]}" control discharge "${control_args[@]}" --execute
      echo
      echo "== after ${AFTER_WAIT_SEC} sec control-status =="
      sleep "$AFTER_WAIT_SEC"
      "${V2H_CMD[@]}" control-status "${common_args[@]}"
      ;;
    standby)
      echo "== standby execute =="
      "${V2H_CMD[@]}" control standby "${control_args[@]}" --execute
      echo
      echo "== after ${AFTER_WAIT_SEC} sec control-status =="
      sleep "$AFTER_WAIT_SEC"
      "${V2H_CMD[@]}" control-status "${common_args[@]}"
      ;;
  esac
} 2>&1 | tee "$LOG_FILE"

RESULT=${PIPESTATUS[0]}
echo "log_file=${LOG_FILE}"
exit "$RESULT"
