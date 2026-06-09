#!/bin/bash
set -e

DUMP_URL='https://static.openbeautyfacts.org/data/openbeautyfacts-mongodbdump.gz'
LOCAL_FILE='openbeautyfacts-mongodbdump.gz'
ETAG_FILE="${LOCAL_FILE}.etag"

apt-get update && apt-get install -y wget curl

SHOULD_DOWNLOAD=1

if [ -f "$LOCAL_FILE" ] && [ -f "$ETAG_FILE" ]; then
  echo "🔍 Found existing dump and ETag. Checking if up to date..."

  SAVED_ETAG=$(cat "$ETAG_FILE" | tr -d '\r"')
  REMOTE_ETAG=$(curl -sI -L "$DUMP_URL" | grep -i '^etag:' | awk '{print $2}' | tr -d '\r"')

  REMOTE_SIZE=$(curl -sI -L "$DUMP_URL" | grep -i '^content-length:' | awk '{print $2}' | tr -d '\r')
  LOCAL_SIZE=$(stat -c %s "$LOCAL_FILE" 2>/dev/null || echo 0)

  if [ -n "$REMOTE_ETAG" ] && [ "$REMOTE_ETAG" = "$SAVED_ETAG" ]; then
    echo "✅ Remote ETag matches saved ETag. Skipping seeding."
    SHOULD_DOWNLOAD=0
  elif [ -n "$REMOTE_SIZE" ] && [ "$REMOTE_SIZE" = "$LOCAL_SIZE" ]; then
    echo "✅ File sizes match. Skipping seeding."
    SHOULD_DOWNLOAD=0
  else
    echo "⚠️ Dump appears to have changed. Downloading fresh version..."
  fi
else
  echo "⬇️ No local dump or ETag found. Downloading..."
fi

if [ $SHOULD_DOWNLOAD -eq 1 ]; then
  wget -q --show-progress -O "$LOCAL_FILE" "$DUMP_URL"
  
  # Save the new ETag for future checks
  REMOTE_ETAG=$(curl -sI -L "$DUMP_URL" | grep -i '^etag:' | awk '{print $2}' | tr -d '\r"')
  if [ -n "$REMOTE_ETAG" ]; then
    echo "$REMOTE_ETAG" > "$ETAG_FILE"
    echo "⏺️ Saved new ETag for future checks."
  fi

  echo "🔄 Restoring dump to MongoDB (this may take a while)..."
  mongorestore --host mongodb --username mongo --password mongo --authenticationDatabase admin --gzip --archive="$LOCAL_FILE" --drop --verbose
  echo "✅ Seeding completed successfully!"
fi