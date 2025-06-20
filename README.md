# 🚀 Upload GitHub Release Assets

A GitHub Action that uploads assets to a GitHub release, with support for overwriting existing assets and validating file existence before upload.

## ✨ Features

- Uploads one or multiple files to the release associated with the current tag
- Automatically checks if each file exists before attempting upload
- Deletes existing assets with the same name to avoid duplication errors
- Outputs detailed upload status and download URLs
- Can be reused locally or as a standalone GitHub Action

## 📦 Usage

### 🔧 Inputs

| Name           | Description                             | Required |
| -------------- | --------------------------------------- | -------- |
| `github_token` | GitHub token with `repo` scope          | ✅ Yes    |
| `files`        | Space-separated list of files to upload | ✅ Yes    |

### 📁 Example workflow

```yaml
name: Upload Release Assets

on:
  release:
    types: [published]

jobs:
  upload:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Upload release assets
        uses: chihqiang/upload-asset-action@main
        with:
          github_token: ${{ secrets.GH_TOKEN }}
          files: |
            dist/app.tar.gz
            dist/app.sha256
```

## 🔐 Permissions

This action requires a GitHub token (`GITHUB_TOKEN`) with `repo` permissions to:

- Fetch release metadata
- Delete existing assets
- Upload new assets
