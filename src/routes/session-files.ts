import { Router, Request, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware.js';
import { getChatSessionById, updateChatSession, FileNode } from '../db/chatSessions.js';
import archiver from 'archiver';

const router: Router = Router();
router.use(authMiddleware);

// 扁平化目录到文件树
function pathToTree(files: Array<{ path: string; content: string }>): FileNode[] {
  const root: FileNode[] = [];

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      const name = parts[i];
      let existing = current.find(n => n.name === name);

      if (isLast) {
        if (!existing) {
          existing = { name, type: 'file', content: file.content };
          current.push(existing);
        } else {
          existing.type = 'file';
          existing.content = file.content;
          existing.children = undefined;
        }
      } else {
        if (!existing) {
          existing = { name, type: 'directory', children: [] };
          current.push(existing);
        }
        if (!existing.children) existing.children = [];
        current = existing.children;
      }
    }
  }

  return root;
}

// POST /api/session/:id/files/extract-zip - 解压 ZIP 到文件树
router.post('/:id/files/extract-zip', async (req: AuthRequest, res: Response) => {
  try {
    const session = await getChatSessionById(req.params.id as string);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.ownerId !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });

    const { files } = req.body;
    if (!Array.isArray(files)) return res.status(400).json({ error: 'files array required' });

    const fileTree = pathToTree(files);
    await updateChatSession(req.params.id as string, { fileTree } as any);

    res.json({ fileTree });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/session/:id/files/tree - 获取文件树
router.get('/:id/files/tree', async (req: AuthRequest, res: Response) => {
  try {
    const session = await getChatSessionById(req.params.id as string);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.ownerId !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });

    res.json({ fileTree: session.fileTree || [] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/session/:id/files/write - 写入文件
router.put('/:id/files/write', async (req: AuthRequest, res: Response) => {
  try {
    const session = await getChatSessionById(req.params.id as string);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.ownerId !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });

    const { path, content } = req.body;
    if (!path) return res.status(400).json({ error: 'path required' });

    let fileTree = session.fileTree || [];
    const parts = path.split('/').filter(Boolean);
    const fileName = parts.pop()!;

    let current = fileTree;
    for (const part of parts) {
      let dir = current.find(n => n.name === part && n.type === 'directory');
      if (!dir) {
        dir = { name: part, type: 'directory', children: [] };
        current.push(dir);
      }
      if (!dir.children) dir.children = [];
      current = dir.children;
    }

    let existing = current.find(n => n.name === fileName);
    if (existing) {
      existing.content = content;
      existing.type = 'file';
    } else {
      current.push({ name: fileName, type: 'file', content });
    }

    await updateChatSession(req.params.id as string, { fileTree } as any);
    res.json({ fileTree });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/session/:id/files/delete - 删除文件或目录
router.delete('/:id/files/delete', async (req: AuthRequest, res: Response) => {
  try {
    const session = await getChatSessionById(req.params.id as string);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.ownerId !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });

    const { path } = req.body;
    if (!path) return res.status(400).json({ error: 'path required' });

    let fileTree = session.fileTree || [];
    const parts = path.split('/').filter(Boolean);
    const targetName = parts.pop()!;

    let current = fileTree;
    for (const part of parts) {
      const dir = current.find(n => n.name === part && n.type === 'directory');
      if (!dir || !dir.children) return res.status(404).json({ error: 'Path not found' });
      current = dir.children;
    }

    const idx = current.findIndex(n => n.name === targetName);
    if (idx === -1) return res.status(404).json({ error: 'File not found' });
    current.splice(idx, 1);

    await updateChatSession(req.params.id as string, { fileTree } as any);
    res.json({ fileTree });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/session/:id/files/read - 读取文件
router.post('/:id/files/read', async (req: AuthRequest, res: Response) => {
  try {
    const session = await getChatSessionById(req.params.id as string);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.ownerId !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });

    const { path } = req.body;
    if (!path) return res.status(400).json({ error: 'path required' });

    const parts = path.split('/').filter(Boolean);
    let current = session.fileTree || [];
    let node: FileNode | undefined;

    for (const part of parts) {
      node = current.find(n => n.name === part);
      if (!node) return res.status(404).json({ error: 'Path not found' });
      if (node.type === 'directory' && node.children) current = node.children;
    }

    if (!node) return res.status(404).json({ error: 'Path not found' });
    if (node.type === 'file') {
      res.json({ name: node.name, content: node.content || '' });
    } else {
      res.json({ name: node.name, type: 'directory', children: node.children || [] });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/session/:id/files/terminal - 模拟终端执行
router.post('/:id/files/terminal', async (req: AuthRequest, res: Response) => {
  try {
    const session = await getChatSessionById(req.params.id as string);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.ownerId !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });

    const { command } = req.body;
    if (!command) return res.status(400).json({ error: 'command required' });

    const fileTree = session.fileTree || [];

    // 模拟终端输出
    const output = await simulateTerminal(command, fileTree);
    res.json({ output, cwd: '/home/project' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/session/:id/files/tree - 获取文件树
router.get('/:id/files/tree', async (req: AuthRequest, res: Response) => {
  try {
    const session = await getChatSessionById(req.params.id as string);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.ownerId !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });

    res.json({ fileTree: session.fileTree || [] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/session/:id/files/write - 写入文件
router.put('/:id/files/write', async (req: AuthRequest, res: Response) => {
  try {
    const session = await getChatSessionById(req.params.id as string);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.ownerId !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });

    const { path, content } = req.body;
    if (!path) return res.status(400).json({ error: 'path required' });

    let fileTree = session.fileTree || [];
    const parts = path.split('/').filter(Boolean);
    const fileName = parts.pop()!;

    let current = fileTree;
    for (const part of parts) {
      let dir = current.find(n => n.name === part && n.type === 'directory');
      if (!dir) {
        dir = { name: part, type: 'directory', children: [] };
        current.push(dir);
      }
      if (!dir.children) dir.children = [];
      current = dir.children;
    }

    let existing = current.find(n => n.name === fileName);
    if (existing) {
      existing.content = content;
      existing.type = 'file';
    } else {
      current.push({ name: fileName, type: 'file', content });
    }

    await updateChatSession(req.params.id as string, { fileTree } as any);
    res.json({ fileTree });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/session/:id/files/delete - 删除文件或目录
router.delete('/:id/files/delete', async (req: AuthRequest, res: Response) => {
  try {
    const session = await getChatSessionById(req.params.id as string);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.ownerId !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });

    const { path } = req.body;
    if (!path) return res.status(400).json({ error: 'path required' });

    let fileTree = session.fileTree || [];
    const parts = path.split('/').filter(Boolean);
    const targetName = parts.pop()!;

    let current = fileTree;
    for (const part of parts) {
      const dir = current.find(n => n.name === part && n.type === 'directory');
      if (!dir || !dir.children) return res.status(404).json({ error: 'Path not found' });
      current = dir.children;
    }

    const idx = current.findIndex(n => n.name === targetName);
    if (idx === -1) return res.status(404).json({ error: 'File not found' });
    current.splice(idx, 1);

    await updateChatSession(req.params.id as string, { fileTree } as any);
    res.json({ fileTree });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/session/:id/files/read - 读取文件
router.post('/:id/files/read', async (req: AuthRequest, res: Response) => {
  try {
    const session = await getChatSessionById(req.params.id as string);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.ownerId !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });

    const { path } = req.body;
    if (!path) return res.status(400).json({ error: 'path required' });

    const parts = path.split('/').filter(Boolean);
    let current = session.fileTree || [];
    let node: FileNode | undefined;

    for (const part of parts) {
      node = current.find(n => n.name === part);
      if (!node) return res.status(404).json({ error: 'Path not found' });
      if (node.type === 'directory' && node.children) current = node.children;
    }

    if (!node) return res.status(404).json({ error: 'Path not found' });
    if (node.type === 'file') {
      res.json({ name: node.name, content: node.content || '' });
    } else {
      res.json({ name: node.name, type: 'directory', children: node.children || [] });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/session/:id/files/terminal - 模拟终端执行
router.post('/:id/files/terminal', async (req: AuthRequest, res: Response) => {
  try {
    const session = await getChatSessionById(req.params.id as string);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.ownerId !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });

    const { command } = req.body;
    if (!command) return res.status(400).json({ error: 'command required' });

    const fileTree = session.fileTree || [];

    // 模拟终端输出
    const output = await simulateTerminal(command, fileTree);
    res.json({ output, cwd: '/home/project' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

async function simulateTerminal(command: string, fileTree: FileNode[]): Promise<string> {
  const parts = command.trim().split(/\s+/);
  const cmd = parts[0];

  switch (cmd) {
    case 'ls': {
      const flag = parts[1] || '';
      const showAll = flag.includes('a');
      const dirs = listNodes(fileTree, '', showAll);
      return dirs.join('\n');
    }
    case 'cat': {
      const filePath = parts[1];
      if (!filePath) return 'cat: missing operand';
      const node = findNode(fileTree, filePath.split('/').filter(Boolean));
      if (!node) return `cat: ${filePath}: No such file or directory`;
      if (node.type === 'directory') return `cat: ${filePath}: Is a directory`;
      return node.content || '';
    }
    case 'node': {
      const filePath = parts[1];
      if (!filePath) return 'node: missing file argument';
      const node = findNode(fileTree, filePath.split('/').filter(Boolean));
      if (!node) return `node: ${filePath}: No such file or directory`;
      // 简单模拟 Node.js 输出
      return `[模拟] Node.js 执行 ${filePath} 完成 (返回 0)`;
    }
    case 'npm': {
      const sub = parts[1];
      if (sub === 'install') return '[模拟] npm install 完成';
      if (sub === 'run') {
        const script = parts.slice(2).join(' ');
        return `[模拟] npm run ${script} 执行完成`;
      }
      if (sub === 'test') return '[模拟] npm test 完成 (所有测试通过)';
      return `[模拟] npm ${sub} 执行完成`;
    }
    case 'mkdir': {
      return `[模拟] 目录 ${parts[1] || ''} 已创建`;
    }
    case 'touch': {
      return `[模拟] 文件 ${parts[1] || ''} 已创建`;
    }
    case 'pwd':
      return '/home/project';
    case 'echo':
      return parts.slice(1).join(' ');
    case 'clear':
      return '';
    default:
      return `bash: ${cmd}: 命令未找到 (模拟终端仅支持: ls, cat, node, npm, mkdir, touch, pwd, echo, clear)`;
  }
}

function findNode(tree: FileNode[], parts: string[]): FileNode | undefined {
  let current = tree;
  for (let i = 0; i < parts.length; i++) {
    const node = current.find(n => n.name === parts[i]);
    if (!node) return undefined;
    if (i === parts.length - 1) return node;
    if (node.type === 'directory' && node.children) current = node.children;
    else return undefined;
  }
  return undefined;
}

function listNodes(tree: FileNode[], prefix: string, showAll: boolean): string[] {
  const result: string[] = [];
  for (const node of tree) {
    if (!showAll && node.name.startsWith('.')) continue;
    const suffix = node.type === 'directory' ? '/' : '';
    result.push(prefix + node.name + suffix);
    if (node.type === 'directory' && node.children) {
      result.push(...listNodes(node.children, prefix + node.name + '/', showAll));
    }
  }
  return result;
}

// POST /api/session/:id/files/upload-zip - 上传并解压 ZIP
router.post('/:id/files/upload-zip', async (req: AuthRequest, res: Response) => {
  try {
    const session = await getChatSessionById(req.params.id as string);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.ownerId !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });

    const { zipBase64 } = req.body;
    if (!zipBase64) return res.status(400).json({ error: 'zipBase64 required' });

    const { writeFile, mkdtemp, rm, readFile } = await import('fs/promises');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const unzipper = (await import('unzipper')).default;

    // 写入临时文件
    const tmpDir = await mkdtemp(join(tmpdir(), 'phantom-zip-'));
    const zipPath = join(tmpDir, 'upload.zip');

    const base64Data = zipBase64.replace(/^data:application\/zip;base64,/, '').replace(/^data:application\/x-zip-compressed;base64,/, '');
    await writeFile(zipPath, Buffer.from(base64Data, 'base64'));

    // 解压
    const { createReadStream } = await import('fs');
    await new Promise<void>((resolve, reject) => {
      createReadStream(zipPath)
        .pipe(unzipper.Extract({ path: tmpDir }))
        .on('close', () => resolve())
        .on('error', reject);
    });

    // 读取解压后的文件（递归）
    const { readdir, stat } = await import('fs/promises');

    async function readDirRecursive(dir: string, basePath: string = ''): Promise<Array<{ path: string; content: string }>> {
      const results: Array<{ path: string; content: string }> = [];
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relPath = basePath ? `${basePath}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          results.push(...await readDirRecursive(fullPath, relPath));
        } else if (entry.isFile() && !entry.name.startsWith('.')) {
          try {
            const content = await readFile(fullPath, 'utf-8');
            results.push({ path: relPath, content });
          } catch {
            results.push({ path: relPath, content: `[Binary file: ${entry.name}]` });
          }
        }
      }
      return results;
    }

    const files = await readDirRecursive(tmpDir);
    // 过滤掉上传的 zip 本身
    const filteredFiles = files.filter(f => f.path !== 'upload.zip');
    const fileTree = pathToTree(filteredFiles);

    // 更新 session
    await updateChatSession(req.params.id as string, { fileTree } as any);

    // 清理临时文件
    await rm(tmpDir, { recursive: true, force: true });

    res.json({ fileTree });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 递归添加文件节点到 archiver
function addToArchive(archive: archiver.Archiver, nodes: FileNode[], basePath: string = '') {
  for (const node of nodes) {
    const fullPath = basePath ? `${basePath}/${node.name}` : node.name;
    if (node.type === 'directory') {
      addToArchive(archive, node.children || [], fullPath);
    } else {
      archive.append(node.content || '', { name: fullPath });
    }
  }
}

// 下载整个项目为 ZIP
router.post('/:id/files/download-zip', async (req: AuthRequest, res: Response) => {
  try {
    const session = await getChatSessionById(req.params.id as string);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!session.fileTree || session.fileTree.length === 0) {
      return res.status(400).json({ error: 'No files in workspace' });
    }

    const archive = archiver('zip', { zlib: { level: 9 } });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${session.title || 'workspace'}.zip"`);

    archive.on('error', (err: Error) => {
      res.status(500).json({ error: err.message });
    });

    archive.pipe(res);
    addToArchive(archive, session.fileTree);
    await archive.finalize();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
