#!/bin/bash
set -euo pipefail  # 遇到错误、未定义变量或管道错误立即退出

set -x

# ========== 配置项 ==========

# GitHub 仓库名（如 user/repo），优先取 GITHUB_REPO，否则取 GitHub Actions 提供的 GITHUB_REPOSITORY
GITHUB_REPO="${GITHUB_REPO:-${GITHUB_REPOSITORY}}"

# 发布的 Tag 名称，优先取 TAG，否则取 GitHub Actions 提供的 GITHUB_REF_NAME
TAG="${TAG:-${GITHUB_REF_NAME}}"

# GitHub Token（需有 repo 权限），为必填项，否则脚本终止
GITHUB_TOKEN="${GITHUB_TOKEN:? GITHUB_TOKEN is required}"

# 处理 RELEASE_BODY，默认使用 TAG
RELEASE_BODY="${RELEASE_BODY:-}"
if [[ -z "$RELEASE_BODY" ]]; then
  RELEASE_BODY="auto-generated release for $TAG"
fi

# 上传的文件列表，支持通过环境变量传入或命令行参数传入
FILES="${FILES:-$@}"


# GitHub API 请求的认证头（推荐使用 Bearer 形式）
HEADER_AUTH="Authorization: Bearer ${GITHUB_TOKEN}"

# ========== 彩色输出工具函数 ==========
color_echo() { local c=$1; shift; echo -e "\033[${c}m$@\033[0m"; }  # 输出带颜色的文本
info()    { color_echo "1;34" "🔍 $@"; }     # 蓝色信息提示
success() { color_echo "1;32" "✅ $@"; }     # 绿色成功提示
warning() { color_echo "1;33" "⚠️  $@"; }    # 黄色警告提示
error()   { color_echo "1;31" "❌ $@"; }     # 红色错误提示
step()    { color_echo "1;36" "🚀 $@"; }     # 青色步骤提示

# ========== 校验触发事件类型 ==========
if [[ "$GITHUB_EVENT_NAME" != "release" && "$GITHUB_EVENT_NAME" != "push" ]]; then
  error "Must be triggered by a 'release' or 'push' event, the current event is: $GITHUB_EVENT_NAME"
  exit 1
fi

# 如果是 push 事件但不是 tag 类型（即非 refs/tags/*），则跳过上传
if [[ "$GITHUB_EVENT_NAME" == "push" && "$GITHUB_REF" != refs/tags/* ]]; then
  warning "Push event is not a tag push, skip uploading"
  exit 0
fi

# 打印基础信息
info "GitHub Repository: $GITHUB_REPO"
info "Publish Tags: $TAG"

# ========== 获取或创建 Release ID ==========
get_or_create_release_id() {
  local repo="$1" tag="$2"
  local res id
  # 尝试根据 tag 获取 release 信息
  res=$(curl -s -H "$HEADER_AUTH" "https://api.github.com/repos/${repo}/releases/tags/${tag}")
  id=$(echo "$res" | jq -r '.id // empty')

  if [[ -n "$id" ]]; then
    echo "$id"
    return 0
  fi
  local payload
  payload=$(jq -n --arg tag "$tag" --arg name "$tag" --arg body "$RELEASE_BODY" '{
    tag_name: $tag,
    name: $name,
    body: $body,
    draft: false,
    prerelease: false
  }')
  # 发送 POST 请求创建 release
  res=$(curl -s -X POST -H "$HEADER_AUTH" -H "Content-Type: application/json" -d "$payload" "https://api.github.com/repos/${repo}/releases")
  id=$(echo "$res" | jq -r '.id // empty')
  if [[ -n "$id" ]]; then
    echo "$id"
    return 0
  else
    echo "$res" | jq '.' >&2
    return 1
  fi
}

# === Upload function ===
upload_asset() {
  local RELEASE_ID="$1"
  local FILE_NAME="$2"
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


# ========== 主执行流程 ==========

# 获取或创建 Release ID
RELEASE_ID=$(get_or_create_release_id "$GITHUB_REPO" "$TAG") || exit 1


success "Successfully obtained Release ID ${RELEASE_ID}"

# 将文件列表拆成数组
read -r -a FILES_ARRAY <<< "$FILES"

# 校验每个文件是否存在
for f in "${FILES_ARRAY[@]}"; do
  if [[ ! -f "$f" ]]; then
    error "File not found: $f"
    exit 1
  fi
done

# 遍历并上传每个文件
for f in "${FILES_ARRAY[@]}"; do
  upload_asset "$RELEASE_ID" "$f" || exit 1
done
