# Upload GitHub Release Assets

A GitHub Action that uploads assets to a GitHub release, with support for cross-repo uploads, auto-generated release notes, and upload retry.

## Features

- Uploads one or multiple files to the release associated with the current tag
- Supports **cross-repo uploads** — specify a different `repo` to upload assets to another repository
- **Auto-creates the tag** on the target repository if it doesn't exist
- **Auto-generates release notes** when no `release_body` is provided (via GitHub's [generate-notes API](https://docs.github.com/en/rest/releases/releases#generate-release-notes-content-for-a-release))
- Supports **glob patterns** (e.g., `*.sha256`, `dist/**`)
- Deletes existing assets with the same name to avoid duplication errors
- **Retries failed uploads** with exponential backoff (3 attempts)
- Outputs detailed upload status and download URLs
- Built with TypeScript for better type safety and maintainability

## Usage

### Inputs

| Name | Description | Required |
| --- | --- | --- |
| `github_token` | GitHub token with `repo` scope | Yes |
| `files` | Space-separated list of files or glob patterns (e.g., `dist/*.sha256`) | Yes |
| `tag` | Git tag name to upload assets to (default: `github.ref_name`) | No |
| `repo` | Target repository in format `owner/repo` (default: current repository) | No |
| `release_body` | Release description body (leave empty to auto-generate release notes) | No |

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

### Cross-repo upload

Upload assets to a different repository:

```yaml
- name: Upload assets to another repo
  uses: chihqiang/upload-asset-action@main
  with:
    github_token: ${{ secrets.GH_TOKEN }}
    files: build/output.zip
    repo: other-org/other-repo
    tag: v1.0.0
```

## Development

### Prerequisites

- Node.js 20+
- npm

### Setup

```bash
npm install
```

### Build

```bash
npm run build
```

### Test

```bash
npm test
```

## License

Apache License 2.0
