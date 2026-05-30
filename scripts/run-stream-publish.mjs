#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function usage() {
  return `Usage: npm run publish:stream:run -- --event /path/to/event.json [--no-deploy] [--no-verify] [--dry-run]

Runs the full host-agent publishing flow:
publish event -> tests -> build -> commit generated post -> push -> deploy -> verify public URL.`;
}

function parseArgs(argv) {
  const args = {
    eventPath: null,
    dryRun: false,
    deploy: true,
    verify: true,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--event') {
      args.eventPath = argv[++i];
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

  if (!args.deploy) {
    args.verify = false;
  }

  return args;
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

async function commitAndPush(relativePath, postId, collection, branch) {
  await git(['add', '--', relativePath]);
  await git(['commit', '-m', `${collection === 'drafts' ? 'Update draft stream' : 'Publish stream entry'}: ${postId}`]);
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
  const args = parseArgs(process.argv.slice(2));
  const eventPath = path.resolve(args.eventPath);
  const branch = await getCurrentBranch();

  await ensureNoTrackedChanges();
  await syncCurrentBranch(branch);
  await ensureNoTrackedChanges();

  const publishResult = await runPublisher(eventPath, args.dryRun);
  if (!publishResult.wrote) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      publishResult,
    }, null, 2));
    return;
  }

  const relativePath = await ensureOnlyExpectedPostChanged(publishResult.outputPath);

  await run('npm', ['run', 'test:publish-stream']);
  await run('npm', ['run', 'build']);
  await commitAndPush(relativePath, publishResult.postId, publishResult.collection, branch);

  let deployed = false;
  let publicUrl = null;

  if (args.deploy && publishResult.collection === 'writing') {
    await run('npm', ['run', 'deploy']);
    deployed = true;

    if (args.verify) {
      publicUrl = await verifyPublicPost(publishResult.postId);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    branch,
    collection: publishResult.collection,
    postId: publishResult.postId,
    committedPath: relativePath,
    pushed: true,
    deployed,
    publicUrl,
    media: publishResult.media,
  }, null, 2));
}

main().catch(error => {
  console.error(`run-stream-publish: ${error.message}`);
  process.exit(1);
});
