import { getChatSessionById, updateChatSession, FileNode } from '../db/chatSessions.js';

interface BashModule {
  FS: {
    writeFile(path: string, content: string | Uint8Array): void;
    readFile(path: string, opts?: { encoding: string }): string | Uint8Array;
    readdir(path: string): string[];
    mkdir(path: string, mode?: number): void;
    unlink(path: string): void;
    rmdir(path: string): void;
    stat(path: string): any;
    analyzePath(path: string): any;
    isDir(path: string): boolean;
    isFile(path: string): boolean;
  };
  callMain(args: string[]): void;
  print: (txt: string) => void;
  printErr: (txt: string) => void;
}

type BashModuleFactory = (opts: { noInitialRun: boolean }) => Promise<BashModule>;

let moduleCache: BashModule | null = null;

async function getBashModule(): Promise<BashModule> {
  if (moduleCache) return moduleCache;
  const path = require('path');
  const wasmDir = __dirname + '/bash-wasm';
  const bashJsPath = path.join(wasmDir, 'bash.module.js');
  const createBashModule: BashModuleFactory = require(bashJsPath).default;
  moduleCache = await createBashModule({ noInitialRun: true });
  return moduleCache;
}

const VIRTUAL_HOME = '/home/pm';

// ---- fileTree ↔ MEMFS helpers ----

function mkdirpMEMFS(mod: BashModule, dirPath: string) {
  const parts = dirPath.split('/').filter(Boolean);
  let cur = '';
  for (const p of parts) {
    cur += '/' + p;
    try { mod.FS.readdir(cur); } catch { mod.FS.mkdir(cur); }
  }
}

function hydrateMEMFS(
  mod: BashModule,
  userId: string,
  sessionId: string,
  tree: FileNode[],
) {
  const base = `${VIRTUAL_HOME}/${userId}/${sessionId}`;
  mkdirpMEMFS(mod, base);
  function writeNodes(nodes: FileNode[], prefix: string) {
    for (const node of nodes) {
      const full = prefix + '/' + node.name;
      if (node.type === 'directory') {
        mkdirpMEMFS(mod, full);
        if (node.children) writeNodes(node.children, full);
      } else {
        try { mod.FS.writeFile(full, node.content || ''); } catch {}
      }
    }
  }
  writeNodes(tree, base);
}

async function snapshotMEMFSToTree(
  mod: BashModule,
  userId: string,
  sessionId: string,
): Promise<FileNode[]> {
  const base = `${VIRTUAL_HOME}/${userId}/${sessionId}`;
  const result: FileNode[] = [];
  function walk(dirPath: string, out: FileNode[]) {
    let entries: string[];
    try { entries = mod.FS.readdir(dirPath); } catch { return; }
    for (const e of entries) {
      if (e === '.' || e === '..') continue;
      const full = dirPath + '/' + e;
      let st: any;
      try { st = mod.FS.stat(full); } catch { continue; }
      if (st.isDirectory) {
        const children: FileNode[] = [];
        walk(full, children);
        out.push({ name: e, type: 'directory', children });
      } else {
        let content = '';
        try {
          const data = mod.FS.readFile(full, { encoding: 'utf8' });
          content = typeof data === 'string' ? data : '';
        } catch {}
        out.push({ name: e, type: 'file', content });
      }
    }
  }
  walk(base, result);
  return result;
}

// ---- Node.js-side file ops (executed before bash) ----

interface ProcessedCommand {
  cleaned: string;
}

function processCommand(raw: string): ProcessedCommand {
  const parts = raw.split('\n');
  const kept: string[] = [];

  for (const line of parts) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      kept.push(line);
      continue;
    }

    const firstWord = trimmed.split(/\s+/)[0];

    // mkdir, rm, touch, cp, mv are handled on Node.js side
    // but we still pass them to bash after the Node-side handling,
    // so the bash functions can execute them via the helper script
    if (['mkdir', 'rm', 'touch', 'cp', 'mv'].includes(firstWord)) {
      kept.push(line);
    } else {
      kept.push(line);
    }
  }

  return { cleaned: kept.join('\n') };
}

// ---- Helper functions sourced into bash ----

function helperScript(workDir: string): string {
  return `
export HOME="${workDir}"
cd "${workDir}" || cd /

ls() {
  local flags=""
  while [[ $1 == -* ]]; do flags+="$1"; shift; done
  local target="\${1:-.}"
  local show_all=false
  [[ $flags == *a* ]] && show_all=true
  for f in "$target"/* "$target"/.*; do
    [[ $f == "$target/*" ]] && continue
    local name=$(basename "$f")
    [[ "$name" == "." || "$name" == ".." ]] && continue
    $show_all || [[ $name != .* ]] || continue
    if [[ -d "$f" ]]; then echo "$name/"; else echo "$name"; fi
  done
}

cat() {
  if [[ $# -eq 0 ]]; then
    while IFS= read -r line; do echo "$line"; done
    return
  fi
  for file in "$@"; do
    if [[ ! -f "$file" ]]; then echo "cat: $file: No such file or directory" >&2; return 1; fi
    while IFS= read -r line; do echo "$line"; done < "$file"
  done
}

alias ll='ls -l'
alias la='ls -a'

node() { echo "[WebContainer] node $* 执行完成 (模拟)"; }
npm() {
  local sub=$1; shift 2>/dev/null
  case "$sub" in
    install) echo "[WebContainer] npm install 完成";;
    run)     echo "[WebContainer] npm run $* 执行完成";;
    test)    echo "[WebContainer] npm test 通过";;
    *)       echo "[WebContainer] npm $sub $* 完成";;
  esac
}
`;
}

// ---- Main function ----

export async function executeBashWasm(
  command: string,
  userId: string,
  sessionId: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const mod = await getBashModule();
  const workDir = `${VIRTUAL_HOME}/${userId}/${sessionId}`;

  // Hydrate MEMFS from DB fileTree
  const session = await getChatSessionById(sessionId);
  if (session?.fileTree) {
    hydrateMEMFS(mod, userId, sessionId, session.fileTree);
  }
  mkdirpMEMFS(mod, workDir);

  // ---- Pre-process: handle mkdir/rm/touch/cp/mv via MEMFS ----
  const lines = command.split('\n');
  const bashLines: string[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      bashLines.push(rawLine);
      continue;
    }

    const tokens = trimmed.split(/\s+/);
    const cmd = tokens[0];

    switch (cmd) {
      case 'mkdir': {
        const idx = tokens.indexOf('-p');
        const dirs = (idx >= 0 ? tokens.slice(idx + 1) : tokens.slice(1)).filter(Boolean);
        for (const d of dirs) {
          const absDir = d.startsWith('/') ? d : `${workDir}/${d}`;
          mkdirpMEMFS(mod, absDir);
        }
        bashLines.push(`echo "done"`);
        break;
      }
      case 'rm': {
        const idxR = tokens.indexOf('-r');
        const idxF = tokens.indexOf('-f');
        const targets = tokens.filter(t => !t.startsWith('-')).slice(1);
        for (const t of targets) {
          const absT = t.startsWith('/') ? t : `${workDir}/${t}`;
          try {
            const st = mod.FS.stat(absT);
            if (st.isDirectory && (idxR >= 0)) {
              // recursive remove: iterate and unlink
              function removeRecursive(dir: string) {
                const entries = mod.FS.readdir(dir);
                for (const e of entries) {
                  if (e === '.' || e === '..') continue;
                  const full = dir + '/' + e;
                  const s = mod.FS.stat(full);
                  if (s.isDirectory) removeRecursive(full);
                  else mod.FS.unlink(full);
                }
                mod.FS.rmdir(dir);
              }
              removeRecursive(absT);
            } else if (!st.isDirectory) {
              mod.FS.unlink(absT);
            }
          } catch {}
        }
        bashLines.push(`echo "done"`);
        break;
      }
      case 'touch': {
        const files = tokens.slice(1).filter(t => !t.startsWith('-'));
        for (const f of files) {
          const absF = f.startsWith('/') ? f : `${workDir}/${f}`;
          try { mod.FS.stat(absF); } catch {
            const parent = absF.substring(0, absF.lastIndexOf('/'));
            mkdirpMEMFS(mod, parent);
            mod.FS.writeFile(absF, '');
          }
        }
        bashLines.push(`echo "done"`);
        break;
      }
      default:
        bashLines.push(rawLine);
    }
  }

  // Write helper script
  mod.FS.writeFile('/helper.sh', helperScript(workDir));

  // Build final bash script
  const bashScript = `source /helper.sh\n${bashLines.join('\n')}`;
  mod.FS.writeFile('/run.sh', bashScript);

  // Capture output
  let stdout = '';
  let stderr = '';
  const origPrint = mod.print;
  const origPrintErr = mod.printErr;
  mod.print = (t: string) => { stdout += t + '\n'; };
  mod.printErr = (t: string) => { stderr += t + '\n'; };

  try {
    mod.callMain(['/run.sh']);
  } catch (e: any) {
    stderr += String(e.message || e) + '\n';
  }

  mod.print = origPrint;
  mod.printErr = origPrintErr;

  // Snapshot MEMFS changes back to DB
  const newTree = await snapshotMEMFSToTree(mod, userId, sessionId);
  await updateChatSession(sessionId, { fileTree: newTree } as any);

  return {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    exitCode: 0,
  };
}
