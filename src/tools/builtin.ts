import { parse } from 'node-html-parser';
import { getChatSessionById, updateChatSession, FileNode } from '../db/chatSessions.js';
import { executeBashWasm } from './bash-wasm.js';

export const BUILTIN_TOOL_NAMES = new Set(['web_fetch', 'web_search', 'file_read', 'file_write', 'file_list', 'edit_file']);

export function hasBuiltinTools(tools: any[]): boolean {
  if (!tools) return false;
  return tools.some((t: any) => BUILTIN_TOOL_NAMES.has(t.function?.name));
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export const BUILTIN_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: 'Fetch and retrieve the content of a web page. Returns the page text content. Use this when you need to read the actual content of a URL.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to fetch',
          },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for current information. Returns related topics, summaries, and source URLs. Use this when you need up-to-date information beyond your training data.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query',
          },
          max_results: {
            type: 'integer',
            description: 'Maximum number of search results to return (default 5)',
            default: 5,
          },
        },
        required: ['query'],
      },
    },
  },
  // {
  //   type: 'function',
  //   function: {
  //     name: 'terminal',
  //     description: 'Simulate a terminal command in the project workspace. Supports: ls, cat, node, npm, mkdir, touch, pwd, echo, clear. Use this to explore the project structure, run code, or install dependencies.',
  //     parameters: {
  //       type: 'object',
  //       properties: {
  //         command: {
  //           type: 'string',
  //           description: 'The shell command to execute',
  //         },
  //       },
  //       required: ['command'],
  //     },
  //   },
  // },
  {
    type: 'function',
    function: {
      name: 'file_read',
      description: 'Read the contents of a file from the project workspace. Returns the full file content.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file (e.g. src/index.js)',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_write',
      description: 'Write content to a file in the project workspace. Creates parent directories if needed. Use this to create new files or modify existing ones.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file (e.g. src/index.js)',
          },
          content: {
            type: 'string',
            description: 'The full file content to write',
          },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_list',
      description: 'List files and directories in the project workspace. Returns a tree structure of all files.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory path to list (default: root /)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Edit a file in the project workspace. You can replace, add, or remove sections of an existing file. Operations are applied sequentially in the order given.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file (e.g. src/index.js)',
          },
          operations: {
            type: 'array',
            description: 'List of edit operations to apply in order. Each operation is applied to the result of the previous one.',
            items: {
              type: 'object',
              properties: {
                op: {
                  type: 'string',
                  enum: ['replace', 'add', 'remove'],
                  description: 'replace = find oldString and replace with newString; add = find oldString and insert newString after it; remove = find oldString and delete it',
                },
                oldString: {
                  type: 'string',
                  description: 'For replace/remove: exact text to find. For add: text to search for (content is inserted after this). Must match exactly.',
                },
                newString: {
                  type: 'string',
                  description: 'For replace: replacement text. For add: text to insert after oldString. Not used for remove.',
                },
              },
              required: ['op'],
            },
          },
        },
        required: ['path', 'operations'],
      },
    },
  },
];

export async function executeWebFetch(args: { url: string }): Promise<string> {
  try {
    const { default: axios } = await import('axios');
    const response = await axios.get(args.url, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      responseType: 'text',
    });
    const html = typeof response.data === 'string' ? response.data : String(response.data);
    const root = parse(html);
    root.querySelectorAll('script, style, nav, footer, header, aside, iframe, noscript').forEach(el => el.remove());
    const text = root.textContent || '';
    const stripped = text.replace(/\s+/g, ' ').trim();
    return stripped.substring(0, 8000);
  } catch (e: any) {
    return `Error fetching URL: ${e.message}`;
  }
}

export async function executeWebSearch(args: { query: string; max_results?: number }): Promise<string> {
  try {
    const { default: axios } = await import('axios');
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(args.query)}&format=json`;
    const response = await axios.get(url, { timeout: 10000 });
    const data = response.data;
    const lines: string[] = [];

    if (data.AbstractText) lines.push(data.AbstractText);
    if (data.Answer) lines.push(`Answer: ${data.Answer}`);
    if (data.AbstractURL) lines.push(`Source: ${data.AbstractURL}`);

    const topics = (data.RelatedTopics || []).slice(0, args.max_results || 5);
    for (const topic of topics) {
      if (topic.Text && topic.FirstURL) {
        lines.push(`- ${topic.Text}\n  ${topic.FirstURL}`);
      }
    }

    return lines.length > 0 ? lines.join('\n\n') : 'No search results found';
  } catch (e: any) {
    return `Error searching web: ${e.message}`;
  }
}

// ---- 文件系统工具 ----

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

function listNodes(tree: FileNode[], showAll: boolean, indent = ''): string[] {
  const result: string[] = [];
  for (const node of tree) {
    if (!showAll && node.name.startsWith('.')) continue;
    const suffix = node.type === 'directory' ? '/' : '';
    result.push(indent + node.name + suffix);
    if (node.type === 'directory' && node.children) {
      result.push(...listNodes(node.children, showAll, indent + '  '));
    }
  }
  return result;
}

async function executeTerminal(args: { command: string }, sessionId?: string): Promise<string> {
  if (!sessionId) return 'Error: No active session';
  const session = await getChatSessionById(sessionId);
  if (!session) return 'Error: Session not found';

  const userId = session.ownerId || 'anonymous';
  try {
    const result = await executeBashWasm(args.command, userId, sessionId);
    let output = '';
    if (result.stdout) output += result.stdout + '\n';
    if (result.stderr) output += result.stderr + '\n';
    return output.trim() || '(no output)';
  } catch (e: any) {
    return `Error executing command: ${e.message}`;
  }
}

async function executeFileRead(args: { path: string }, sessionId?: string): Promise<string> {
  if (!sessionId) return 'Error: No active session';
  const session = await getChatSessionById(sessionId);
  if (!session) return 'Error: Session not found';
  const fileTree = session.fileTree || [];

  const node = findNode(fileTree, args.path.split('/').filter(Boolean));
  if (!node) return `Error: ${args.path}: No such file or directory`;
  if (node.type === 'directory') return `Error: ${args.path}: Is a directory`;
  return node.content || '';
}

async function executeFileWrite(args: { path: string; content: string }, sessionId?: string): Promise<string> {
  if (!sessionId) return 'Error: No active session';
  const session = await getChatSessionById(sessionId);
  if (!session) return 'Error: Session not found';
  let fileTree = session.fileTree || [];

  const parts = args.path.split('/').filter(Boolean);
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
    existing.content = args.content;
    existing.type = 'file';
  } else {
    current.push({ name: fileName, type: 'file', content: args.content });
  }

  await updateChatSession(sessionId, { fileTree } as any);
  return `Written ${args.path} (${args.content.length} bytes)`;
}

async function executeFileList(args: { path?: string }, sessionId?: string): Promise<string> {
  if (!sessionId) return 'Error: No active session';
  const session = await getChatSessionById(sessionId);
  if (!session) return 'Error: Session not found';
  const fileTree = session.fileTree || [];

  const targetPath = args.path || '';
  if (!targetPath || targetPath === '/') {
    return listNodes(fileTree, false).join('\n') || '(empty project)';
  }

  const node = findNode(fileTree, targetPath.split('/').filter(Boolean));
  if (!node) return `Error: ${targetPath}: No such file or directory`;
  if (node.type === 'file') return `Error: ${targetPath}: Not a directory`;
  return listNodes(node.children || [], false).join('\n') || '(empty)';
}

async function executeEditFile(args: { path: string; operations: Array<{ op: string; oldString?: string; newString?: string }> }, sessionId?: string): Promise<string> {
  if (!sessionId) return 'Error: No active session';
  const session = await getChatSessionById(sessionId);
  if (!session) return 'Error: Session not found';
  const fileTree = session.fileTree || [];

  const parts = args.path.split('/').filter(Boolean);
  const node = findNode(fileTree, parts);
  if (!node) return `Error: ${args.path}: No such file or directory`;
  if (node.type === 'directory') return `Error: ${args.path}: Is a directory`;

  let content = node.content || '';
  const appliedOps: string[] = [];

  for (let i = 0; i < args.operations.length; i++) {
    const op = args.operations[i];
    switch (op.op) {
      case 'replace': {
        if (!op.oldString) return `Error: Operation ${i}: oldString is required for replace`;
        if (op.newString === undefined) return `Error: Operation ${i}: newString is required for replace`;
        const idx = content.indexOf(op.oldString);
        if (idx === -1) return `Error: Operation ${i}: Could not find '${op.oldString.substring(0, 80)}' in ${args.path}`;
        content = content.substring(0, idx) + op.newString + content.substring(idx + op.oldString.length);
        appliedOps.push(`replaced at ${idx}`);
        break;
      }
      case 'add': {
        if (!op.oldString) return `Error: Operation ${i}: oldString (search text) is required for add`;
        if (op.newString === undefined) return `Error: Operation ${i}: newString (content to insert) is required for add`;
        const idx = content.indexOf(op.oldString);
        if (idx === -1) return `Error: Operation ${i}: Could not find '${op.oldString.substring(0, 80)}' in ${args.path}`;
        content = content.substring(0, idx + op.oldString.length) + op.newString + content.substring(idx + op.oldString.length);
        appliedOps.push(`added after ${idx + op.oldString.length}`);
        break;
      }
      case 'remove': {
        if (!op.oldString) return `Error: Operation ${i}: oldString is required for remove`;
        const idx = content.indexOf(op.oldString);
        if (idx === -1) return `Error: Operation ${i}: Could not find '${op.oldString.substring(0, 80)}' in ${args.path}`;
        content = content.substring(0, idx) + content.substring(idx + op.oldString.length);
        appliedOps.push(`removed at ${idx}`);
        break;
      }
      default:
        return `Error: Operation ${i}: unknown operation '${op.op}' (must be replace, add, or remove)`;
    }
  }

  node.content = content;
  await updateChatSession(sessionId, { fileTree } as any);
  return `Edited ${args.path}: ${appliedOps.join('; ')}`;
}

// ---- 主入口 ----

export async function executeBuiltinTool(
  toolCall: { name: string; arguments: string; tool_call_id?: string },
  sessionId?: string
): Promise<{ role: string; tool_call_id: string; content: string }> {
  let args: any = {};
  try {
    args = JSON.parse(toolCall.arguments || '{}');
  } catch {
    args = {};
  }

  let result: string;
  switch (toolCall.name) {
    case 'web_fetch':
      result = await executeWebFetch(args);
      break;
    case 'web_search':
      result = await executeWebSearch(args);
      break;
    case 'terminal':
      result = await executeTerminal(args, sessionId);
      break;
    case 'file_read':
      result = await executeFileRead(args, sessionId);
      break;
    case 'file_write':
      result = await executeFileWrite(args, sessionId);
      break;
    case 'file_list':
      result = await executeFileList(args, sessionId);
      break;
    case 'edit_file':
      result = await executeEditFile(args, sessionId);
      break;
    default:
      result = `Unknown tool: ${toolCall.name}`;
  }

  return {
    role: 'tool',
    tool_call_id: toolCall.tool_call_id || toolCall.name,
    content: result,
  };
}
