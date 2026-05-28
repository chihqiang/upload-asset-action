import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import { Release } from '../src/release';

vi.mock('@actions/core', () => ({
  getInput: vi.fn(),
  setFailed: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

function mockOctokit() {
  const getReleaseByTag = vi.fn();
  const generateReleaseNotes = vi.fn();
  const createRelease = vi.fn();
  const getRef = vi.fn();
  const createRef = vi.fn();
  const listReleaseAssets = vi.fn();
  const deleteReleaseAsset = vi.fn();
  const uploadReleaseAsset = vi.fn();
  const getRepo = vi.fn();

  const octokit = {
    rest: {
      repos: {
        getReleaseByTag,
        generateReleaseNotes,
        createRelease,
        listReleaseAssets,
        deleteReleaseAsset,
        uploadReleaseAsset,
        get: getRepo,
      },
      git: { getRef, createRef },
    },
  } as any;

  return { octokit, getReleaseByTag, generateReleaseNotes, createRelease, getRef, createRef, listReleaseAssets, deleteReleaseAsset, uploadReleaseAsset, getRepo };
}

/** 让 ensureRelease 成功返回指定 releaseId（跳过真实 API 调用） */
async function setupRelease(octokit: any, releaseId = 100) {
  const { getReleaseByTag } = octokit.rest.repos;
  getReleaseByTag.mockResolvedValue({ data: { id: releaseId } });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('Release', () => {
  describe('ensureRelease', () => {
    it('should return existing release ID', async () => {
      const { octokit, getReleaseByTag } = mockOctokit();
      getReleaseByTag.mockResolvedValue({ data: { id: 42 } });

      const release = new Release(octokit, 'owner', 'repo', 'v1.0.0');
      const id = await release.ensureRelease('my body');

      expect(id).toBe(42);
      expect(getReleaseByTag).toHaveBeenCalledWith({
        owner: 'owner', repo: 'repo', tag: 'v1.0.0',
      });
    });

    it('should create tag and release when release does not exist', async () => {
      const { octokit, getReleaseByTag, getRef, getRepo, createRef, createRelease } = mockOctokit();
      getReleaseByTag.mockRejectedValue({ status: 404 });
      getRef
        .mockRejectedValueOnce({ status: 404 }) // tag 不存在
        .mockResolvedValueOnce({ data: { object: { sha: 'abc123' } } }); // 默认分支 ref
      getRepo.mockResolvedValue({ data: { default_branch: 'main' } });
      createRef.mockResolvedValue({});
      createRelease.mockResolvedValue({ data: { id: 99 } });

      const release = new Release(octokit, 'owner', 'repo', 'v1.0.0');
      const id = await release.ensureRelease('my body');

      expect(id).toBe(99);
      expect(createRef).toHaveBeenCalledWith({
        owner: 'owner', repo: 'repo', ref: 'refs/tags/v1.0.0', sha: 'abc123',
      });
      expect(createRelease).toHaveBeenCalledWith({
        owner: 'owner', repo: 'repo', tag_name: 'v1.0.0', name: 'v1.0.0',
        body: 'my body', draft: false, prerelease: false,
      });
    });

    it('should not create tag if it already exists', async () => {
      const { octokit, getReleaseByTag, getRef, createRef, createRelease } = mockOctokit();
      getReleaseByTag.mockRejectedValue({ status: 404 });
      getRef.mockResolvedValue({}); // tag 已存在
      createRelease.mockResolvedValue({ data: { id: 77 } });

      const release = new Release(octokit, 'owner', 'repo', 'v1.0.0');
      const id = await release.ensureRelease('my body');

      expect(id).toBe(77);
      expect(createRef).not.toHaveBeenCalled();
    });

    it('should generate release notes when body is empty', async () => {
      const { octokit, getReleaseByTag, generateReleaseNotes, createRelease, getRef } = mockOctokit();
      getReleaseByTag.mockRejectedValue({ status: 404 });
      getRef.mockResolvedValue({});
      generateReleaseNotes.mockResolvedValue({ data: { body: 'auto notes' } });
      createRelease.mockResolvedValue({ data: { id: 55 } });

      const release = new Release(octokit, 'owner', 'repo', 'v1.0.0');
      const id = await release.ensureRelease('');

      expect(id).toBe(55);
      expect(generateReleaseNotes).toHaveBeenCalled();
      expect(createRelease).toHaveBeenCalledWith(
        expect.objectContaining({ body: 'auto notes' })
      );
    });
  });

  describe('uploadAll', () => {
    beforeEach(() => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('content'));
    });

    it('should upload all files successfully', async () => {
      const { octokit, listReleaseAssets, uploadReleaseAsset } = mockOctokit();
      listReleaseAssets.mockResolvedValue({ data: [] });
      uploadReleaseAsset.mockResolvedValue({
        data: { name: 'file.txt', browser_download_url: 'https://example.com/file.txt' },
      });

      await setupRelease(octokit);
      const release = new Release(octokit, 'owner', 'repo', 'v1.0.0');
      await release.ensureRelease('body');

      const assets = await release.uploadAll(['file.txt']);
      expect(assets).toHaveLength(1);
      expect(assets[0].name).toBe('file.txt');
      expect(uploadReleaseAsset).toHaveBeenCalledTimes(1);
    });

    it('should delete existing asset with same name before upload', async () => {
      const { octokit, listReleaseAssets, deleteReleaseAsset, uploadReleaseAsset } = mockOctokit();
      listReleaseAssets.mockResolvedValue({
        data: [{ id: 1, name: 'file.txt' }],
      });
      uploadReleaseAsset.mockResolvedValue({
        data: { name: 'file.txt', browser_download_url: 'https://example.com/file.txt' },
      });

      await setupRelease(octokit);
      const release = new Release(octokit, 'owner', 'repo', 'v1.0.0');
      await release.ensureRelease('body');

      const assets = await release.uploadAll(['file.txt']);
      expect(assets).toHaveLength(1);
      expect(deleteReleaseAsset).toHaveBeenCalledWith({
        owner: 'owner', repo: 'repo', asset_id: 1,
      });
    });

    it('should delete multiple existing assets before upload', async () => {
      const { octokit, listReleaseAssets, deleteReleaseAsset, uploadReleaseAsset } = mockOctokit();
      listReleaseAssets
        .mockResolvedValueOnce({ data: [{ id: 1, name: 'a.txt' }] })
        .mockResolvedValueOnce({ data: [{ id: 2, name: 'b.txt' }] });
      uploadReleaseAsset
        .mockResolvedValueOnce({ data: { name: 'a.txt', browser_download_url: 'https://example.com/a.txt' } })
        .mockResolvedValueOnce({ data: { name: 'b.txt', browser_download_url: 'https://example.com/b.txt' } });

      await setupRelease(octokit);
      const release = new Release(octokit, 'owner', 'repo', 'v1.0.0');
      await release.ensureRelease('body');

      const assets = await release.uploadAll(['a.txt', 'b.txt']);
      expect(assets).toHaveLength(2);
      expect(deleteReleaseAsset).toHaveBeenCalledTimes(2);
    });

    it('should retry on upload failure and succeed', async () => {
      const { octokit, listReleaseAssets, uploadReleaseAsset } = mockOctokit();
      listReleaseAssets.mockResolvedValue({ data: [] });
      uploadReleaseAsset
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce({ data: { name: 'file.txt', browser_download_url: 'https://example.com/file.txt' } });

      await setupRelease(octokit);
      const release = new Release(octokit, 'owner', 'repo', 'v1.0.0');
      await release.ensureRelease('body');

      const assets = await release.uploadAll(['file.txt']);
      expect(assets).toHaveLength(1);
      expect(uploadReleaseAsset).toHaveBeenCalledTimes(2);
    });
  });
});
