#!/bin/sh
# HAProxy entrypoint script

set -e

CONFIG="/usr/local/etc/haproxy/haproxy.cfg"

echo "Starting HAProxy..."

# Start HAProxy with the config
exec haproxy -W -db -f "$CONFIG" "$@"
