#!/bin/sh
# Non-interactive verification of an immutable Java submission snapshot.
set -u
mkdir -p /workspace /tmp/classes /tmp/adminerva-probe
cp -R /source/. /workspace/
cd /workspace
set -- $(find . -type f -name '*.java' ! -name 'SwingProbe.java' -print | sort)
if [ "$#" -eq 0 ]; then
  echo "__ADMINERVA_VERIFY__stage=compile;ok=false;reason=no_java_files" >&2
  exit 20
fi
SQLITE_JAR="/usr/share/java/sqlite-jdbc.jar"
[ -f "$SQLITE_JAR" ] || SQLITE_JAR="/usr/share/java/xerial-sqlite-jdbc.jar"
CLASSPATH="/tmp/classes:."
[ -f "$SQLITE_JAR" ] && CLASSPATH="$CLASSPATH:$SQLITE_JAR"
if ! javac -encoding UTF-8 -cp "$CLASSPATH" -d /tmp/classes "$@"; then
  echo "__ADMINERVA_VERIFY__stage=compile;ok=false" >&2
  exit 20
fi
echo "__ADMINERVA_VERIFY__stage=compile;ok=true" >&2

DB_READY=false
if [ -f /source/__adminerva_db.sql ]; then
  if sqlite3 /workspace/adminerva.db < /source/__adminerva_db.sql; then
    DB_READY=true
    echo "__ADMINERVA_VERIFY__stage=database_bootstrap;ok=true" >&2
  else
    echo "__ADMINERVA_VERIFY__stage=database_bootstrap;ok=false" >&2
  fi
fi
export ADMINERVA_DB_URL="jdbc:sqlite:/workspace/adminerva.db"
export ADMINERVA_DB_PATH="/workspace/adminerva.db"

PROFILE="${VERIFY_PROFILE:-java_console}"
STATUS=0
if echo "$PROFILE" | grep -q '^java_swing'; then
  if ! javac -encoding UTF-8 -cp "$CLASSPATH" -d /tmp/adminerva-probe /opt/adminerva/SwingProbe.java; then
    echo "__ADMINERVA_VERIFY__stage=gui_probe_compile;ok=false" >&2
    STATUS=21
  else
    set +e
    timeout 12s xvfb-run -a java -cp "/tmp/adminerva-probe:$CLASSPATH" SwingProbe "$MAIN_CLASS"
    STATUS=$?
    set -e
    echo "__ADMINERVA_VERIFY__stage=runtime;exit=$STATUS;mode=swing" >&2
  fi
else
  set +e
  if [ -f /source/__adminerva_stdin.txt ]; then
    timeout 12s java -cp "$CLASSPATH" "$MAIN_CLASS" < /source/__adminerva_stdin.txt
  else
    timeout 12s java -cp "$CLASSPATH" "$MAIN_CLASS"
  fi
  STATUS=$?
  set -e
  echo "__ADMINERVA_VERIFY__stage=runtime;exit=$STATUS;mode=console" >&2
fi

if [ "$DB_READY" = true ]; then
  INTEGRITY="$(sqlite3 /workspace/adminerva.db 'PRAGMA integrity_check;' 2>/dev/null || true)"
  if [ "$INTEGRITY" = "ok" ]; then
    echo "__ADMINERVA_VERIFY__stage=database_integrity;ok=true" >&2
  else
    echo "__ADMINERVA_VERIFY__stage=database_integrity;ok=false" >&2
  fi
  if [ -d /source/__adminerva_db_checks ]; then
    for check in /source/__adminerva_db_checks/*.sql; do
      [ -f "$check" ] || continue
      NAME="$(basename "$check" .sql)"
      RESULT="$(sqlite3 -batch -noheader /workspace/adminerva.db < "$check" 2>&1 || true)"
      ENCODED="$(printf '%s' "$RESULT" | base64 | tr -d '\n')"
      echo "__ADMINERVA_DB_CHECK__${NAME}:${ENCODED}" >&2
    done
  fi
fi
exit "$STATUS"
