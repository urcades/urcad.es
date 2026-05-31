#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import {
  createSkippedCrosspostResult,
  crossPostStream,
  loadSocialCrosspostConfig,
  sanitizeSocialError,
} from './social-crosspost.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tokenRelativePath = path.join('Library', 'Application Support', 'urcad.es', 'cloudflare-api-token');

function usage() {
  return `Usage: npm run publish:stream:run -- --event /path/to/event.json [--result-json /absolute/path.json] [--no-deploy] [--no-verify] [--dry-run]

Runs the full host-agent publishing flow:
publish event -> tests -> build -> commit generated post -> push -> deploy -> verify public URL.`;
}

function parseArgs(argv) {
  const args = {
    eventPath: null,
    dryRun: false,
    deploy: true,
    verify: true,
    resultJsonPath: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--event') {
      args.eventPath = argv[++i];
      if (!args.eventPath) {
        throw new Error('--event requires a path.');
      }
    } else if (arg === '--result-json') {
      args.resultJsonPath = argv[++i];
      if (!args.resultJsonPath) {
        throw new Error('--result-json requires a path.');
      }
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--no-deploy') {
      args.deploy = false;
    } else if (arg === '--no-verify') {
      args.verify = false;
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.eventPath) {
    throw new Error('Missing required --event argument.');
  }

  if (args.resultJsonPath && !path.isAbsolute(args.resultJsonPath)) {
    throw new Error('--result-json must be an absolute path.');
  }

  if (!args.deploy) {
    args.verify = false;
  }

  return args;
}

async function writeResultJson(resultJsonPath, payload) {
  if (!resultJsonPath) return;

  const dir = path.dirname(resultJsonPath);
  const base = path.basename(resultJsonPath);
  const tempPath = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;

  await mkdir(dir, { recursive: true });
  await writeFile(tempPath, serialized);
  await rename(tempPath, resultJsonPath);
}

async function tryWriteResultJson(resultJsonPath, payload) {
  try {
    await writeResultJson(resultJsonPath, payload);
  } catch (error) {
    console.error(`run-stream-publish: failed to write result JSON: ${error.message}`);
  }
}

async function finish(resultJsonPath, payload) {
  await writeResultJson(resultJsonPath, payload);
  console.log(JSON.stringify(payload, null, 2));
}

function tailLines(value, count = 20) {
  return String(value || '')
    .split('\n')
    .filter(Boolean)
    .slice(-count)
    .join('\n');
}

export function getCloudflareApiTokenFilePath(homeDir = process.env.HOME) {
  if (!homeDir) {
    throw new Error('Cannot resolve Cloudflare token file without HOME.');
  }

  return path.join(homeDir, tokenRelativePath);
}

function hasUnsafePermissionBits(mode) {
  return (mode & 0o077) !== 0;
}

export async function resolveCloudflareApiToken({ env = process.env } = {}) {
  const homeDir = env.HOME || process.env.HOME;
  const tokenPath = getCloudflareApiTokenFilePath(homeDir);

  try {
    const info = await stat(tokenPath);
    if (hasUnsafePermissionBits(info.mode)) {
      throw new Error(`Cloudflare API token file must use owner-only permissions: ${tokenPath}`);
    }

    const token = (await readFile(tokenPath, 'utf8')).trim();
    if (!token) {
      throw new Error(`Cloudflare API token file is empty: ${tokenPath}`);
    }

    return token;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  const envToken = env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
  return envToken ? envToken.trim() : null;
}

export async function createChildEnv({
  baseEnv = process.env,
  needsCloudflareApiToken = false,
} = {}) {
  const childEnv = { ...baseEnv };
  delete childEnv.CLOUDFLARE_API_TOKEN;

  if (needsCloudflareApiToken) {
    const token = await resolveCloudflareApiToken({ env: baseEnv });
    if (token) {
      childEnv.CLOUDFLARE_API_TOKEN = token;
    }
  }

  return childEnv;
}

async function run(command, args, options = {}) {
  const env = await createChildEnv({
    needsCloudflareApiToken: options.needsCloudflareApiToken,
  });

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      encoding: 'utf8',
      env,
    });

    let stdout = '';
    let stderr = '';

    if (options.capture) {
      child.stdout.on('data', chunk => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', chunk => {
        stderr += chunk.toString();
      });
    }

    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = new Error(`${command} ${args.join(' ')} exited with code ${code}${stderr ? `\n${tailLines(stderr)}` : ''}`);
        error.exitCode = code;
        error.command = command;
        error.args = args;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });
  });
}

async function git(args, options = {}) {
  return await run('git', args, options);
}

async function ensureNoTrackedChanges() {
  const { stdout } = await git(['status', '--porcelain', '--untracked-files=no'], { capture: true });
  if (stdout.trim()) {
    throw new Error(`Tracked worktree changes exist before publishing:\n${stdout}`);
  }
}

async function getCurrentBranch() {
  const { stdout } = await git(['branch', '--show-current'], { capture: true });
  const branch = stdout.trim();
  if (!branch) {
    throw new Error('Cannot publish from detached HEAD.');
  }
  return branch;
}

async function syncCurrentBranch(branch) {
  await git(['fetch', 'origin', branch]);

  const { stdout: localHead } = await git(['rev-parse', 'HEAD'], { capture: true });
  const { stdout: remoteHead } = await git(['rev-parse', 'FETCH_HEAD'], { capture: true });

  if (localHead.trim() === remoteHead.trim()) {
    return;
  }

  await git(['merge', '--ff-only', 'FETCH_HEAD']);
}

async function runPublisher(eventPath, dryRun) {
  const args = ['scripts/publish-stream.mjs', '--event', eventPath];
  if (dryRun) args.push('--dry-run');

  const { stdout } = await run(process.execPath, args, {
    capture: true,
    needsCloudflareApiToken: true,
  });
  return JSON.parse(stdout);
}

async function ensureOnlyExpectedPostChanged(outputPath) {
  const relativePath = path.relative(repoRoot, outputPath);
  const { stdout } = await git(['status', '--porcelain', '--', relativePath], { capture: true });
  const changedPaths = stdout
    .split('\n')
    .filter(line => line.length > 0)
    .map(line => line.slice(3));

  if (changedPaths.length !== 1 || changedPaths[0] !== relativePath) {
    throw new Error(`Expected only ${relativePath} to change, got:\n${stdout || '(no tracked changes)'}`);
  }

  return relativePath;
}

async function commitPost(relativePath, postId, collection) {
  await git(['add', '--', relativePath]);
  await git(['commit', '-m', `${collection === 'drafts' ? 'Update draft stream' : 'Publish stream entry'}: ${postId}`]);
  const { stdout } = await git(['rev-parse', 'HEAD'], { capture: true });
  return stdout.trim();
}

async function pushBranch(branch) {
  await git(['push', 'origin', branch]);
}

async function verifyPublicPost(postId) {
  const url = `https://www.urcad.es/writing/${postId}/`;

  for (let attempt = 1; attempt <= 6; attempt++) {
    const response = await fetch(url, { redirect: 'follow' });
    if (response.ok) {
      return url;
    }

    await new Promise(resolve => setTimeout(resolve, attempt * 1000));
  }

  throw new Error(`Public URL did not return 200 after deploy: ${url}`);
}

export function getCrosspostSkipReason({ args, publishResult, publicUrl }) {
  if (args.dryRun) return 'dry run';
  if (publishResult.collection !== 'writing') return 'not a published writing post';
  if (!args.deploy) return 'deploy disabled';
  if (!args.verify) return 'public URL verification disabled';
  if (!publicUrl) return 'public URL unavailable';
  return null;
}

export async function runCrosspostPhase({
  args,
  publishResult,
  publicUrl,
  loadConfig = loadSocialCrosspostConfig,
  crossPost = crossPostStream,
} = {}) {
  const skipReason = getCrosspostSkipReason({ args, publishResult, publicUrl });
  if (skipReason) {
    return createSkippedCrosspostResult(skipReason);
  }

  let config;
  try {
    config = await loadConfig({ allowMissing: true });
  } catch (error) {
    return createSkippedCrosspostResult(sanitizeSocialError(error));
  }

  if (!config) {
    return createSkippedCrosspostResult('social config missing');
  }

  try {
    return await crossPost({
      text: publishResult.body || '',
      postId: publishResult.postId,
      publicUrl,
      media: publishResult.media || [],
      config,
    });
  } catch (error) {
    return createSkippedCrosspostResult(sanitizeSocialError(error, config));
  }
}

async function main() {
  const result = {
    ok: false,
    phase: 'parse_args',
    branch: null,
    collection: null,
    postId: null,
    committedPath: null,
    commit: null,
    pushed: false,
    deployed: false,
    publicUrl: null,
    media: [],
    crossposts: null,
  };

  let resultJsonPath = null;

  try {
    const args = parseArgs(process.argv.slice(2));
    resultJsonPath = args.resultJsonPath;
    const eventPath = path.resolve(args.eventPath);

    result.phase = 'get_branch';
    const branch = await getCurrentBranch();
    result.branch = branch;

    if (args.dryRun) {
      result.phase = 'publish';
      const publishResult = await runPublisher(eventPath, true);
      result.collection = publishResult.collection;
      result.postId = publishResult.postId;
      result.media = publishResult.media;
      result.crossposts = await runCrosspostPhase({
        args,
        publishResult,
        publicUrl: null,
      });
      result.ok = true;
      result.phase = 'dry_run';
      await finish(resultJsonPath, {
        ...result,
        dryRun: true,
      });
      return;
    }

    result.phase = 'preflight_clean';
    await ensureNoTrackedChanges();

    result.phase = 'sync_branch';
    await syncCurrentBranch(branch);

    result.phase = 'post_sync_clean';
    await ensureNoTrackedChanges();

    result.phase = 'publish';
    const publishResult = await runPublisher(eventPath, args.dryRun);
    result.collection = publishResult.collection;
    result.postId = publishResult.postId;
    result.media = publishResult.media;

    result.phase = 'verify_changed_path';
    const relativePath = await ensureOnlyExpectedPostChanged(publishResult.outputPath);
    result.committedPath = relativePath;

    result.phase = 'test';
    await run('npm', ['run', 'test:publish-stream']);

    result.phase = 'build';
    await run('npm', ['run', 'build']);

    result.phase = 'commit';
    result.commit = await commitPost(relativePath, publishResult.postId, publishResult.collection);

    result.phase = 'push';
    await pushBranch(branch);
    result.pushed = true;

    if (args.deploy && publishResult.collection === 'writing') {
      result.phase = 'deploy';
      await run('npm', ['run', 'worker:deploy'], {
        capture: true,
        needsCloudflareApiToken: true,
      });
      result.deployed = true;

      if (args.verify) {
        result.phase = 'verify';
        result.publicUrl = await verifyPublicPost(publishResult.postId);
      }
    }

    result.phase = 'crosspost';
    result.crossposts = await runCrosspostPhase({
      args,
      publishResult,
      publicUrl: result.publicUrl,
    });

    result.ok = true;
    result.phase = 'complete';
    await finish(resultJsonPath, result);
  } catch (error) {
    result.message = error.message;
    result.error = {
      message: error.message,
    };
    if (error.exitCode !== undefined) {
      result.error.exitCode = error.exitCode;
    }
    if (error.stdout) {
      result.error.stdoutTail = tailLines(error.stdout);
    }
    if (error.stderr) {
      result.error.stderrTail = tailLines(error.stderr);
    }
    await tryWriteResultJson(resultJsonPath, result);
    console.error(`run-stream-publish: ${error.message}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`run-stream-publish: ${error.message}`);
    process.exit(1);
  });
}
