#!/bin/bash

# ======= Config =======
# Warehouse name, in the format of username/warehouse name

GITHUB_REPO="${GITHUB_REPO:-${GITHUB_REPOSITORY}}"
# Release tag name
TAG="${TAG:-${GITHUB_REF_NAME}}"
# GitHub Personal Access Token (requires repo permissions)  
GITHUB_TOKEN="${GITHUB_TOKEN:? GITHUB_TOKEN is required}"
# Support passing in parameters
FILES="${FILES:-$@}"


# === Colored output helpers ===
color_echo() {
  local color_code=$1
  shift
  echo -e "\033[${color_code}m$@\033[0m"
}
info()    { color_echo "1;34" "🔍 $@"; }
success() { color_echo "1;32" "✅ $@"; }
warning() { color_echo "1;33" "⚠️  $@"; }
error()   { color_echo "1;31" "❌ $@"; }
step()    { color_echo "1;36" "🚀 $@"; }
divider() { echo -e "\033[1;30m--------------------------------------------------\033[0m"; }

if [ -z "$FILES" ]; then
  error "No files specified. Skipping upload."
  exit 0
fi

if [ "$GITHUB_EVENT_NAME" != "release" ]; then
  error "This script must be triggered by a 'release' event. Current event: $GITHUB_EVENT_NAME"
  exit 1
fi

info "GitHub Repo: $GITHUB_REPO"
info "GitHub Tag: $TAG"

HEADER_AUTH="Authorization: token ${GITHUB_TOKEN}"
# === Get release ID ===
step "Fetching release ID for tag: ${TAG}"
RELEASE_JSON=$(curl -s -H "${HEADER_AUTH}" "https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${TAG}")
RELEASE_ID=$(echo "$RELEASE_JSON" | jq -r '.id')
if [ "$RELEASE_ID" == "null" ] || [ -z "$RELEASE_ID" ]; then
  error "Release not found for tag: ${TAG}"
  exit 1
fi
success "Release ID: $RELEASE_ID"

# === Upload function ===
upload_asset() {
  local FILE_NAME="$1"
  local BASE_NAME
  BASE_NAME="$(basename "$FILE_NAME")"
  if [ ! -f "$FILE_NAME" ]; then
    error "File not found: $FILE_NAME"
    return 1
  fi
  
  step "Checking existing assets: $BASE_NAME"
  local ASSETS_JSON ASSET_ID
  ASSETS_JSON=$(curl -s -H "${HEADER_AUTH}" "https://api.github.com/repos/${GITHUB_REPO}/releases/${RELEASE_ID}/assets")
  ASSET_ID=$(echo "$ASSETS_JSON" | jq -r --arg name "$BASE_NAME" '.[] | select(.name == $name) | .id')

  if [ -n "$ASSET_ID" ]; then
    local HTTP_STATUS
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE -H "${HEADER_AUTH}" "https://api.github.com/repos/${GITHUB_REPO}/releases/assets/${ASSET_ID}")
    if [ "$HTTP_STATUS" -eq 204 ]; then
      success "Deleted existing asset: $BASE_NAME"
    else
      error "Failed to delete asset. HTTP status: $HTTP_STATUS"
      return 1
    fi
  fi

  step "Uploading file: $FILE_NAME"
  local UPLOAD_RAW HTTP_CODE HTTP_BODY
  UPLOAD_RAW=$(curl -s -w "\n%{http_code}" -X POST -H "${HEADER_AUTH}" -H "Content-Type: application/octet-stream" \
    --data-binary @"$FILE_NAME" \
    "https://uploads.github.com/repos/${GITHUB_REPO}/releases/${RELEASE_ID}/assets?name=${BASE_NAME}"
    )

  HTTP_CODE=$(echo "$UPLOAD_RAW" | tail -n1 | tr -d '\r')
  HTTP_BODY=$(echo "$UPLOAD_RAW" | sed '$d')
  if ! [[ "$HTTP_CODE" =~ ^[0-9]{3}$ ]]; then
    error "Unexpected HTTP status: $HTTP_CODE"
    return 1
  fi
  echo "$HTTP_BODY" | jq '.'
  if [ "$HTTP_CODE" -eq 201 ]; then
    success "Upload successful: $BASE_NAME"
    DOWNLOAD_URL=$(echo "$HTTP_BODY" | jq -r '.browser_download_url // empty')
    if [ -n "$DOWNLOAD_URL" ]; then
      success "Download URL: $DOWNLOAD_URL"
    fi
  else
    error "Upload failed: $BASE_NAME. HTTP status: $HTTP_CODE"
    return 1
  fi
}


IFS=' ' read -r -a FILES_ARRAY <<< "$(echo "$FILES" | tr '\n' ' ')"

# === Check if all files exist ===
check_files_exist() {
  local all_exist=true
  for FILE in "${FILES_ARRAY[@]}"; do
    if [ ! -f "$FILE" ]; then
      error "File not found: $FILE"
      all_exist=false
    fi
  done

  if [ "$all_exist" = false ]; then
    error "One or more files do not exist. Aborting upload."
    exit 1
  fi
}

check_files_exist

for FILE in "${FILES_ARRAY[@]}"; do
  upload_asset ${FILE} || exit 1
done