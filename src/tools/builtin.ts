import { parse } from 'node-html-parser';

export const BUILTIN_TOOL_NAMES = new Set(['web_fetch', 'web_search']);

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

export async function executeBuiltinTool(
  toolCall: { name: string; arguments: string; tool_call_id?: string }
): Promise<{ role: string; tool_call_id: string; content: string }> {
  let args: any = {};
  try {
    args = JSON.parse(toolCall.arguments || '{}');
  } catch {
    args = {};
  }

  let result: string;
  if (toolCall.name === 'web_fetch') {
    result = await executeWebFetch(args);
  } else if (toolCall.name === 'web_search') {
    result = await executeWebSearch(args);
  } else {
    result = `Unknown tool: ${toolCall.name}`;
  }

  return {
    role: 'tool',
    tool_call_id: toolCall.tool_call_id || toolCall.name,
    content: result,
  };
}
