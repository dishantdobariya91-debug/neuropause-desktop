/**
 * S132 — tests for the GitHub Actions least-privilege assertion
 * (`scripts/verify-workflow-permissions.cjs`). Proves the classifier fails closed on a missing block,
 * write-all, and stray write scopes; permits the allowlisted release-write; and — END-TO-END — that EVERY
 * real workflow in `.github/workflows` is least-privilege.
 */
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';

const require = createRequire(import.meta.url);
const { classifyWorkflowPermissions, DEFAULT_WRITE_ALLOWLIST } = require('../../../../../scripts/verify-workflow-permissions.cjs') as {
  classifyWorkflowPermissions: (name: string, doc: unknown, allowlist?: Record<string, string[]>) => { ok: boolean; errors: string[] };
  DEFAULT_WRITE_ALLOWLIST: Record<string, string[]>;
};

const workflowsDir = join(__dirname, '..', '..', '..', '..', '..', '.github', 'workflows');

describe('S132 · workflow least-privilege classifier (fail-closed)', () => {
  it('REJECTS a workflow with no permissions block', () => {
    const r = classifyWorkflowPermissions('x.yml', { on: {}, jobs: {} });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/no top-level permissions block/);
  });

  it('REJECTS write-all', () => {
    expect(classifyWorkflowPermissions('x.yml', { permissions: 'write-all' }).ok).toBe(false);
  });

  it('ACCEPTS read-all and contents: read', () => {
    expect(classifyWorkflowPermissions('x.yml', { permissions: 'read-all' }).ok).toBe(true);
    expect(classifyWorkflowPermissions('x.yml', { permissions: { contents: 'read' } }).ok).toBe(true);
  });

  it('REJECTS an unexpected write scope not in the allowlist', () => {
    const r = classifyWorkflowPermissions('x.yml', { permissions: { contents: 'read', packages: 'write' } });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/unexpected write scope 'packages:write'/);
  });

  it('ACCEPTS the allowlisted release-write (contents: write) only for the named release workflows', () => {
    expect(classifyWorkflowPermissions('macos-release.yml', { permissions: { contents: 'write' } }).ok).toBe(true);
    expect(classifyWorkflowPermissions('windows-release.yml', { permissions: { contents: 'write' } }).ok).toBe(true);
    // the SAME write scope on a non-release workflow is rejected
    expect(classifyWorkflowPermissions('desktop-ci.yml', { permissions: { contents: 'write' } }).ok).toBe(false);
  });

  it('the allowlist is minimal — exactly the two release workflows, contents:write only', () => {
    expect(DEFAULT_WRITE_ALLOWLIST).toEqual({
      'macos-release.yml': ['contents:write'],
      'windows-release.yml': ['contents:write'],
    });
  });
});

describe('S132 · every real workflow is least-privilege', () => {
  const files = readdirSync(workflowsDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

  it('there are workflows to check (guard against an empty scan)', () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  for (const f of files) {
    it(`${f} — declares a least-privilege permissions block`, () => {
      const doc = yaml.load(readFileSync(join(workflowsDir, f), 'utf8'));
      const r = classifyWorkflowPermissions(f, doc);
      expect(r.ok, r.errors.join('; ')).toBe(true);
    });
  }
});
