# Upload GitHub Release Assets

A GitHub Action that uploads assets to a GitHub release, with support for overwriting existing assets and validating file existence before upload.

## Features

- Uploads one or multiple files to the release associated with the current tag
- Supports **glob patterns** (e.g., `*.sha256`, `dist/**`)
- Automatically checks if each file exists before attempting upload
- Deletes existing assets with the same name to avoid duplication errors
- Outputs detailed upload status and download URLs
- Built with TypeScript for better type safety and maintainability

## Usage

### Inputs

| Name | Description | Required |
| --- | --- | --- |
| `github_token` | GitHub token with `repo` scope | Yes |
| `files` | Space-separated list of files or glob patterns (e.g., `dist/*.sha256`) | Yes |
| `tag` | Git tag name to upload assets to | No |
| `repo` | Repository in format "owner/repo" | No |
| `release_body` | Release description body | No |

### Example workflow

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

      - name: Build
        run: |
          tar czf dist/app.tar.gz ./dist
          sha256sum dist/app.tar.gz > dist/app.sha256

      - name: Upload release assets
        uses: chihqiang/upload-asset-action@main
        with:
          github_token: ${{ secrets.GH_TOKEN }}
          files: |
            dist/app.tar.gz
            dist/*.sha256
```

### Using Glob Patterns

You can use glob patterns to match multiple files:

```yaml
- name: Upload release assets
  uses: chihqiang/upload-asset-action@main
  with:
    github_token: ${{ secrets.GH_TOKEN }}
    files: |
      dist/*.sha256
      dist/*.md5
      builds/*.zip
```

## Permissions

This action requires a GitHub token (`GITHUB_TOKEN`) with `repo` permissions to:

- Fetch release metadata
- Delete existing assets
- Upload new assets

## Development

### Prerequisites

- Node.js 20+
- pnpm (or npm/yarn)

### Build

```bash
pnpm install
pnpm build
```

### Type Checking

```bash
pnpm test
```

## License

MIT
