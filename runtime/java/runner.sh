#!/bin/sh
# Unprivileged, ephemeral Java workspace. The source snapshot is mounted read-only.
set -eu
mkdir -p /workspace /tmp/classes
cp -R /source/. /workspace/
cd /workspace
set -- $(find . -type f -name '*.java' -print | sort)
if [ "$#" -eq 0 ]; then
  echo "No Java source files provided." >&2
  exit 2
fi
javac -encoding UTF-8 -d /tmp/classes "$@"
exec java -XX:MaxRAMPercentage=60 -cp /tmp/classes:. "$MAIN_CLASS"
