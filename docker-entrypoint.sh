#!/bin/sh
# Drop to the unprivileged cairn user after making a mounted volume writable.
# Fly volumes arrive root-owned; the image runs as uid 10001.
set -e
if [ -d /data ] && [ "$(id -u)" = "0" ]; then
  mkdir -p /data
  chown -R cairn:cairn /data
fi
if [ "$(id -u)" = "0" ]; then
  exec su -s /bin/sh cairn -c 'exec node server.mjs'
fi
exec node server.mjs
