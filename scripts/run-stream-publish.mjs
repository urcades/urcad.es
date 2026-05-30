#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdir, rename, writeFile } from 'node:fs/promises';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      encoding: 'utf8',
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
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}${stderr ? `\n${stderr}` : ''}`));
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

  const { stdout } = await run(process.execPath, args, { capture: true });
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
  };

  let resultJsonPath = null;

  try {
    const args = parseArgs(process.argv.slice(2));
    resultJsonPath = args.resultJsonPath;
    const eventPath = path.resolve(args.eventPath);

    result.phase = 'get_branch';
    const branch = await getCurrentBranch();
    result.branch = branch;

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

    if (!publishResult.wrote) {
      result.ok = true;
      result.phase = 'dry_run';
      await finish(resultJsonPath, {
        ...result,
        dryRun: true,
      });
      return;
    }

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
      await run('npm', ['run', 'deploy']);
      result.deployed = true;

      if (args.verify) {
        result.phase = 'verify';
        result.publicUrl = await verifyPublicPost(publishResult.postId);
      }
    }

    result.ok = true;
    result.phase = 'complete';
    await finish(resultJsonPath, result);
  } catch (error) {
    result.error = {
      message: error.message,
    };
    await tryWriteResultJson(resultJsonPath, result);
    console.error(`run-stream-publish: ${error.message}`);
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(`run-stream-publish: ${error.message}`);
  process.exit(1);
});
