#!/bin/bash
exe="$1"
shift
if [ "${1:-}" = "-x" ]; then
  shift 2
fi
diag_file="/tmp/duelplay_cs2_gdb_$(date +%Y%m%d_%H%M%S)_${DUELPLAY_SERVER_ID:-cs2-2}.log"
gdb -q -batch \
  -ex "set pagination off" \
  -ex "set confirm off" \
  -ex "set logging file ${diag_file}" \
  -ex "set logging enabled on" \
  -ex "set logging stdout on" \
  -ex "handle SIGSEGV stop print" \
  -ex "run" \
  -ex "thread apply all bt full" \
  -ex "info proc mappings" \
  -ex "info sharedlibrary" \
  -ex "kill" \
  -ex "quit"
gdb_status=$?
if grep -q "SIGSEGV" "$diag_file"; then
  exit 1
fi
exit $gdb_status
