import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import {
  Box,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  IconButton,
  TextField,
  Button,
  Paper,
  Typography,
  Avatar,
  Chip,
  Menu,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Select,
  FormControl,
  InputLabel,
  useTheme,
  useMediaQuery,
  Alert,
  Switch,
  FormControlLabel,
  CircularProgress,
  Tooltip,
  Snackbar,
  Fade,
  Collapse,
  Divider,
  Popover,
  Slider,
  Fab,
} from '@mui/material';
import {
  Send,
  Plus,
  MoreVertical,
  Settings,
  Trash2,
  Edit3,
  Menu as MenuIcon,
  MessageSquare,
  Paperclip,
  X,
  Copy,
  RotateCcw,
  Check,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Brain,
  Wrench,
  Clock,
  Zap,
  ChevronRight,
  Globe,
  Globe2,
  Lock,
  Info,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '../contexts/AuthContext';
import { useServer } from '../contexts/ServerContext';
import { useSidebar } from '../contexts/SidebarContext';
import { useChat } from '../contexts/ChatContext';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { copyToClipboard } from '../utils/clipboard';

// ==================== 类型定义 ====================

type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  files?: Array<{
    id: string;
    name: string;
    type: string;
    size: number;
    dataUrl?: string; // 兼容旧的base64格式
    attachmentId?: string; // 新的CDN附件ID
  }>;
  thinking?: string;
  toolCalls?: ToolCall[];
  model?: string; // AI消息使用的模型
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  _isStreaming?: boolean; // 标记是否正在流式生成
  replyTo?: {
    // 引用消息
    messageId: string;
    content: string;
    role: 'user' | 'assistant';
  };
};

type ToolCall = {
  id: string;
  name: string;
  arguments: string;
  result?: string;
};

type UploadedFile = {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl?: string;
  textContent?: string;
  attachmentId?: string; // 服务器附件ID
  loading?: boolean; // 加载状态
  progress?: number; // 上传进度 0-100
};

type ApiType = 'openai-chat' | 'openai-responses' | 'anthropic-messages' | 'gemini';

type ChatSession = {
  id: string;
  title: string;
  model: string;
  systemPrompt: string;
  apiType: ApiType;
  stream: boolean;
  timeout: number;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  isPublic?: boolean;
  ownerId?: string;
  isOwner?: boolean;
  isReadOnly?: boolean;
};

// ==================== 工具函数 ====================

function formatContextLength(length: number): string {
  if (length >= 1000000) {
    return `${(length / 1000000).toFixed(1)}M`;
  } else if (length >= 1000) {
    return `${(length / 1000).toFixed(0)}K`;
  }
  return length.toString();
}

// ==================== 常量 ====================

const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.';
const DRAWER_WIDTH = 280;
const MAX_FILE_COUNT = 3;
const MAX_FILE_SIZE_TEXT = 200 * 1024 * 1024;
const MAX_FILE_SIZE_IMAGE = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const DEFAULT_TIMEOUT = 60;

const API_TYPES: { value: ApiType; label: string }[] = [
  { value: 'openai-chat', label: 'OpenAI Chat Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'gemini', label: 'Gemini' },
];

// ==================== 工具函数 ====================

// 解析 thinking 标签
function parseThinkingContent(content: string): { thinking: string; output: string } {
  const thinkingMatch = content.match(/<thinking>([\s\S]*?)<\/thinking>/);
  if (thinkingMatch) {
    const thinking = thinkingMatch[1].trim();
    const output = content.replace(/<thinking>[\s\S]*?<\/thinking>/, '').trim();
    return { thinking, output };
  }
  return { thinking: '', output: content };
}

// ==================== 代码块组件 ====================

interface CodeBlockProps {
  className?: string;
  children: React.ReactNode;
}

const CodeBlock = memo(function CodeBlock({ className, children }: CodeBlockProps) {
  const { t = (key: string, defaultValue?: string) => defaultValue || key } = useTranslation();
  const [copied, setCopied] = useState(false);
  const theme = useTheme();
  const codeString = String(children).replace(/\n$/, '');
  const language = className?.replace('language-', '') || '';

  const handleCopy = async () => {
    await copyToClipboard(codeString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Paper
      elevation={0}
      sx={{
        position: 'relative',
        bgcolor: theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.04)',
        borderRadius: '8px',
        my: 1.5,
        overflow: 'hidden',
        border: 1,
        borderColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 1.5,
          py: 0.75,
          bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
          borderBottom: 1,
          borderColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
        }}
      >
        <Typography
          variant="caption"
          sx={{
            fontFamily: 'monospace',
            color: 'text.secondary',
            textTransform: 'uppercase',
            fontSize: '0.7rem',
            letterSpacing: '0.05em',
          }}
        >
          {language || 'code'}
        </Typography>
        <Tooltip title={copied ? t('chat.copied') : t('chat.copyCode')}>
          <IconButton size="small" onClick={handleCopy} sx={{ p: 0.5 }}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </IconButton>
        </Tooltip>
      </Box>

      <Box
        component="pre"
        sx={{
          m: 0,
          p: 1.5,
          overflow: 'auto',
          fontFamily: '"Fira Code", "JetBrains Mono", Consolas, monospace',
          fontSize: '0.8125rem',
          lineHeight: 1.6,
          '& code': {
            fontFamily: 'inherit',
            fontSize: 'inherit',
          },
        }}
      >
        <code className={className}>{children}</code>
      </Box>
    </Paper>
  );
});

// ==================== 内联代码组件 ====================

const InlineCode = memo(function InlineCode({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <Box
      component="code"
      sx={{
        fontFamily: 'monospace',
        fontSize: '0.875em',
        px: 0.5,
        py: 0.1,
        mx: 0.25,
        borderRadius: '3px',
        bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
        color: theme.palette.mode === 'dark' ? '#e879f9' : '#9333ea',
        display: 'inline-block',
      }}
    >
      {children}
    </Box>
  );
});

// ==================== Markdown 渲染组件 ====================

interface MarkdownContentProps {
  content: string;
}

const MarkdownContent = memo(function MarkdownContent({ content }: MarkdownContentProps) {
  const theme = useTheme();

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code: ({ inline, className, children, ...props }: any) => {
          if (inline) {
            return <InlineCode>{children}</InlineCode>;
          }
          return <CodeBlock className={className}>{children}</CodeBlock>;
        },
        p: ({ children }) => (
          <Typography
            component="p"
            sx={{
              my: 1,
              lineHeight: 1.7,
              '&:first-of-type': { mt: 0 },
              '&:last-of-type': { mb: 0 },
            }}
          >
            {children}
          </Typography>
        ),
        a: ({ href, children }) => (
          <Box
            component="a"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            sx={{
              color: 'primary.main',
              textDecoration: 'none',
              '&:hover': { textDecoration: 'underline' },
            }}
          >
            {children}
          </Box>
        ),
        ul: ({ children }) => (
          <Box component="ul" sx={{ my: 1, pl: 2.5 }}>
            {children}
          </Box>
        ),
        ol: ({ children }) => (
          <Box component="ol" sx={{ my: 1, pl: 2.5 }}>
            {children}
          </Box>
        ),
        li: ({ children }) => (
          <Box component="li" sx={{ my: 0.5, lineHeight: 1.7 }}>
            {children}
          </Box>
        ),
        blockquote: ({ children }) => (
          <Box
            component="blockquote"
            sx={{
              my: 1.5,
              pl: 2,
              py: 0.5,
              borderLeft: 3,
              borderColor: 'primary.main',
              bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
              borderRadius: '0 4px 4px 0',
              '& p': { my: 0.5 },
            }}
          >
            {children}
          </Box>
        ),
        table: ({ children }) => (
          <Box sx={{ overflowX: 'auto', my: 1.5 }}>
            <Box
              component="table"
              sx={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '0.875rem',
                '& th, & td': {
                  border: 1,
                  borderColor: 'divider',
                  px: 1.5,
                  py: 1,
                  textAlign: 'left',
                },
                '& th': {
                  bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                  fontWeight: 600,
                },
              }}
            >
              {children}
            </Box>
          </Box>
        ),
        h1: ({ children }) => (
          <Typography variant="h5" sx={{ mt: 2, mb: 1, fontWeight: 600 }}>
            {children}
          </Typography>
        ),
        h2: ({ children }) => (
          <Typography variant="h6" sx={{ mt: 2, mb: 1, fontWeight: 600 }}>
            {children}
          </Typography>
        ),
        h3: ({ children }) => (
          <Typography variant="subtitle1" sx={{ mt: 1.5, mb: 0.75, fontWeight: 600 }}>
            {children}
          </Typography>
        ),
        hr: () => (
          <Box
            component="hr"
            sx={{
              my: 2,
              border: 'none',
              borderTop: 1,
              borderColor: 'divider',
            }}
          />
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
});

// ==================== {t('chat.thinkingProcess')}组件 ====================

interface ThinkingBlockProps {
  content: string;
}

const ThinkingBlock = memo(function ThinkingBlock({ content }: ThinkingBlockProps) {
  const { t = (key: string, defaultValue?: string) => defaultValue || key } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const theme = useTheme();

  return (
    <Paper
      elevation={0}
      sx={{
        mb: 1.5,
        overflow: 'hidden',
        bgcolor: theme.palette.mode === 'dark' ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.08)',
        border: 1,
        borderColor: theme.palette.mode === 'dark' ? 'rgba(139,92,246,0.3)' : 'rgba(139,92,246,0.2)',
        borderRadius: '12px',
      }}
    >
      <Box
        onClick={() => setExpanded(!expanded)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 1,
          cursor: 'pointer',
          '&:hover': {
            bgcolor: theme.palette.mode === 'dark' ? 'rgba(139,92,246,0.15)' : 'rgba(139,92,246,0.12)',
          },
        }}
      >
        <Brain size={16} style={{ color: '#8b5cf6' }} />
        <Typography variant="body2" sx={{ flex: 1, fontWeight: 500, color: '#8b5cf6' }}>
          {t('chat.thinkingProcess')}
        </Typography>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </Box>
      <Collapse in={expanded}>
        <Box
          sx={{
            px: 1.5,
            pb: 1.5,
            pt: 0.5,
            fontSize: '0.875rem',
            color: 'text.secondary',
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
          }}
        >
          {content}
        </Box>
      </Collapse>
    </Paper>
  );
});

// ==================== 工具调用组件 ====================

interface ToolCallBlockProps {
  toolCalls: ToolCall[];
}

const ToolCallBlock = memo(function ToolCallBlock({ toolCalls }: ToolCallBlockProps) {
  const { t = (key: string, defaultValue?: string) => defaultValue || key } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const theme = useTheme();

  return (
    <Paper
      elevation={0}
      sx={{
        mb: 1.5,
        overflow: 'hidden',
        bgcolor: theme.palette.mode === 'dark' ? 'rgba(34,197,94,0.1)' : 'rgba(34,197,94,0.08)',
        border: 1,
        borderColor: theme.palette.mode === 'dark' ? 'rgba(34,197,94,0.3)' : 'rgba(34,197,94,0.2)',
        borderRadius: '12px',
      }}
    >
      <Box
        onClick={() => setExpanded(!expanded)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 1,
          cursor: 'pointer',
          '&:hover': {
            bgcolor: theme.palette.mode === 'dark' ? 'rgba(34,197,94,0.15)' : 'rgba(34,197,94,0.12)',
          },
        }}
      >
        <Wrench size={16} style={{ color: '#22c55e' }} />
        <Typography variant="body2" sx={{ flex: 1, fontWeight: 500, color: '#22c55e' }}>
          {t('chat.toolCallsCalled', { count: toolCalls.length })}
        </Typography>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </Box>
      <Collapse in={expanded}>
        <Box sx={{ px: 1.5, pb: 1.5 }}>
          {toolCalls.map((tool, index) => (
            <Box
              key={tool.id || index}
              sx={{
                mt: index > 0 ? 1 : 0.5,
                p: 1,
                bgcolor: theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.04)',
                borderRadius: '8px',
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary', mb: 0.5 }}>
                {tool.name}
              </Typography>
              <Typography
                variant="caption"
                component="pre"
                sx={{
                  fontFamily: 'monospace',
                  fontSize: '0.75rem',
                  color: 'text.secondary',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {tool.arguments}
              </Typography>
              {tool.result && (
                <Box sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: 'divider' }}>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {t('chat.result')}:
                  </Typography>
                  <Typography
                    variant="caption"
                    component="pre"
                    sx={{
                      fontFamily: 'monospace',
                      fontSize: '0.75rem',
                      color: 'text.primary',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                    }}
                  >
                    {tool.result}
                  </Typography>
                </Box>
              )}
            </Box>
          ))}
        </Box>
      </Collapse>
    </Paper>
  );
});

// ==================== 图片附件组件 ====================
interface ImageAttachmentProps {
  file: {
    id: string;
    name: string;
    type: string;
    dataUrl?: string;
    attachmentId?: string;
  };
  onPreview: (url: string) => void;
}

const ImageAttachment = memo(function ImageAttachment({ file, onPreview }: ImageAttachmentProps) {
  const { token } = useAuth();
  const [blobUrl, setBlobUrl] = useState<string>('');
  const [error, setError] = useState(false);

  useEffect(() => {
    // 如果有attachmentId，从服务器获取Blob URL
    if (file.attachmentId && token) {
      const loadBlobUrl = async () => {
        try {
          const { getAttachmentBlobUrl } = await import('../utils/attachments');
          const url = await getAttachmentBlobUrl(token, file.attachmentId);
          setBlobUrl(url);
        } catch (err) {
          console.error('Failed to load attachment:', err);
          setError(true);
        }
      };
      loadBlobUrl();
    }

    // 清理Blob URL
    return () => {
      if (blobUrl.startsWith('blob:')) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [file.attachmentId, token]);

  // 显示逻辑：优先使用Blob URL，其次base64，最后显示错误
  const displayUrl = blobUrl || file.dataUrl;

  if (error && !file.dataUrl) {
    return (
      <Box
        sx={{
          width: 80,
          height: 80,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '12px',
          bgcolor: 'action.hover',
        }}
      >
        <Typography variant="caption" color="text.secondary">
          加载失败
        </Typography>
      </Box>
    );
  }

  if (!displayUrl) {
    return (
      <Box
        sx={{
          width: 80,
          height: 80,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '12px',
          bgcolor: 'action.hover',
        }}
      >
        <CircularProgress size={24} />
      </Box>
    );
  }

  return (
    <Box
      component="img"
      src={displayUrl}
      alt={file.name}
      onClick={() => onPreview(displayUrl)}
      sx={{
        width: 80,
        height: 80,
        objectFit: 'cover',
        borderRadius: '12px',
        cursor: 'pointer',
        transition: 'transform 0.2s',
        '&:hover': { transform: 'scale(1.05)' },
      }}
    />
  );
});

// ==================== 消息组件 ====================

interface MessageBubbleProps {
  message: ChatMessage;
  index: number;
  isLoading: boolean;
  isLastMessage: boolean;
  isReadOnly: boolean;
  onCopy: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onResend: () => void;
  onImagePreview: (url: string) => void;
  onInfo?: () => void;
}

const MessageBubble = memo(function MessageBubble({
  message,
  index,
  isLoading,
  isLastMessage,
  isReadOnly,
  onCopy,
  onDelete,
  onEdit,
  onResend,
  onImagePreview,
  onInfo,
}: MessageBubbleProps) {
  const theme = useTheme();
  const isUser = message.role === 'user';
  const { t = (key: string, defaultValue?: string) => defaultValue || key } = useTranslation();
  const [showActions, setShowActions] = useState(false);

  if (message.role === 'system') return null;

  // 解析思考内容
  const { thinking, output } = useMemo(() => {
    if (!isUser && message.content) {
      return parseThinkingContent(message.content);
    }
    return { thinking: message.thinking || '', output: message.content };
  }, [message.content, message.thinking, isUser]);

  // 用户消息
  if (isUser) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'flex-end',
          mb: 2,
          px: 2,
        }}
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
      >
        <Box sx={{ maxWidth: { xs: '85%', sm: '70%' }, minWidth: 0 }}>
          {message.files && message.files.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1, justifyContent: 'flex-end' }}>
              {message.files.map((file) => (
                <Box key={file.id}>
                  {file.type.startsWith('image/') ? (
                    <ImageAttachment file={file} onPreview={onImagePreview} />
                  ) : (
                    <Chip size="small" icon={<Paperclip size={14} />} label={file.name} sx={{ borderRadius: '8px' }} />
                  )}
                </Box>
              ))}
            </Box>
          )}

          <Paper
            elevation={0}
            sx={{
              px: 2,
              py: 1.25,
              borderRadius: '18px',
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              wordBreak: 'break-word',
            }}
          >
            <Typography sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: '0.9375rem' }}>
              {message.content}
            </Typography>
          </Paper>

          <Fade in={showActions}>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5, mt: 0.5 }}>
              <Tooltip title="复制">
                <IconButton 
                  size="small" 
                  onClick={onCopy} 
                  sx={{ opacity: 0.6 }}
                  disabled={isReadOnly}
                >
                  <Copy size={14} />
                </IconButton>
              </Tooltip>
              <Tooltip title="编辑">
                <IconButton 
                  size="small" 
                  onClick={onEdit} 
                  sx={{ opacity: isReadOnly ? 0.3 : 0.6 }}
                  disabled={isReadOnly}
                >
                  <Edit3 size={14} />
                </IconButton>
              </Tooltip>
              <Tooltip title="重发">
                <IconButton 
                  size="small" 
                  onClick={onResend} 
                  sx={{ opacity: isReadOnly ? 0.3 : 0.6 }}
                  disabled={isReadOnly}
                >
                  <RotateCcw size={14} />
                </IconButton>
              </Tooltip>
              <Tooltip title="删除">
                <IconButton 
                  size="small" 
                  onClick={onDelete} 
                  sx={{ opacity: isReadOnly ? 0.3 : 0.6 }}
                  disabled={isReadOnly}
                >
                  <Trash2 size={14} />
                </IconButton>
              </Tooltip>
            </Box>
          </Fade>
        </Box>
      </Box>
    );
  }

  // AI 消息
  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1.5,
        mb: 2,
        px: 2,
      }}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <Avatar
        sx={{
          width: 32,
          height: 32,
          bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
          color: 'text.primary',
          flexShrink: 0,
        }}
      >
        {isLoading && isLastMessage && !message.content ? (
          <CircularProgress size={16} color="inherit" />
        ) : (
          <Sparkles size={16} />
        )}
      </Avatar>

      <Box sx={{ flex: 1, minWidth: 0, maxWidth: { xs: '100%', sm: '85%' } }}>
        {/* {t('chat.thinkingProcess')} */}
        {thinking && <ThinkingBlock content={thinking} />}

        {/* 工具调用 */}
        {message.toolCalls && message.toolCalls.length > 0 && <ToolCallBlock toolCalls={message.toolCalls} />}

        {/* 主要内容 */}
        <Box
          sx={{
            px: 0,
            py: 0.5,
            wordBreak: 'break-word',
          }}
        >
          {output ? (
            <Box sx={{ fontSize: '0.9375rem' }}>
              <MarkdownContent content={output} />
            </Box>
          ) : isLoading && isLastMessage ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box
                sx={{
                  display: 'flex',
                  gap: 0.5,
                  '& span': {
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    bgcolor: 'text.secondary',
                    animation: 'pulse 1.4s infinite',
                  },
                  '& span:nth-of-type(2)': { animationDelay: '0.2s' },
                  '& span:nth-of-type(3)': { animationDelay: '0.4s' },
                  '@keyframes pulse': {
                    '0%, 80%, 100%': { opacity: 0.3 },
                    '40%': { opacity: 1 },
                  },
                }}
              >
                <span />
                <span />
                <span />
              </Box>
              <Typography variant="body2" color="text.secondary">
                {t('chat.thinking')}
              </Typography>
            </Box>
          ) : null}
        </Box>

        {output && (
          <Fade in={showActions}>
            <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}>
              <Tooltip title="复制">
                <IconButton size="small" onClick={onCopy} sx={{ opacity: 0.6 }}>
                  <Copy size={14} />
                </IconButton>
              </Tooltip>
              <Tooltip title="查看信息">
                <IconButton size="small" onClick={onInfo} sx={{ opacity: 0.6 }}>
                  <Info size={14} />
                </IconButton>
              </Tooltip>
              <Tooltip title="删除">
                <IconButton 
                  size="small" 
                  onClick={onDelete} 
                  sx={{ opacity: isReadOnly ? 0.3 : 0.6 }}
                  disabled={isReadOnly}
                >
                  <Trash2 size={14} />
                </IconButton>
              </Tooltip>
            </Box>
          </Fade>
        )}
      </Box>
    </Box>
  );
});

// ==================== 主组件 ====================

export function UserChatPage() {
  const { t = (key: string, defaultValue?: string) => defaultValue || key } = useTranslation();
  const { token } = useAuth();
  const { user } = useAuth();
  const { models } = useServer();
  const { toggleMobileOpen } = useSidebar();
  const { sessions, currentSessionId, setCurrentSessionId, createNewSession, deleteSession, updateSession, setSessions, loadSessionFromServer, loadSessionsFromServer } = useChat();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { id: sessionIdFromUrl } = useParams<{ id?: string }>();
  const navigate = useNavigate();

  // 状态
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '' });
  const [isReadOnly, setIsReadOnly] = useState(false);

  // 队列和流式控制
  const [messageQueue, setMessageQueue] = useState<Array<{ input: string; files: UploadedFile[] }>>([]);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // 编辑状态
  const [editingTitle, setEditingTitle] = useState('');
  const [editingSystemPrompt, setEditingSystemPrompt] = useState('');
  const [editingModel, setEditingModel] = useState('');
  const [editingApiType, setEditingApiType] = useState<ApiType>('openai-chat');
  const [editingStream, setEditingStream] = useState(false);
  const [editingTimeout, setEditingTimeout] = useState(DEFAULT_TIMEOUT);

  // 快捷设置 Popover
  const [modelAnchor, setModelAnchor] = useState<null | HTMLElement>(null);
  const [optionsAnchor, setOptionsAnchor] = useState<null | HTMLElement>(null);

  // 图片预览
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState('');

  // 消息信息对话框
  const [messageInfoOpen, setMessageInfoOpen] = useState(false);
  const [messageInfo, setMessageInfo] = useState<ChatMessage | null>(null);

  // 滚动控制
  const [isUserNearBottom, setIsUserNearBottom] = useState(true);
  const messageContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 流式更新的 ref
  const streamContentRef = useRef<string>('');
  const streamUpdateTimeoutRef = useRef<number | null>(null);

  // ==================== 计算属性 ====================

  const currentSession = useMemo(() => {
    return sessions.find((s) => s.id === currentSessionId) || null;
  }, [sessions, currentSessionId]);

  // ==================== 滚动控制 ====================

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  useEffect(() => {
    const container = messageContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      setIsUserNearBottom(scrollHeight - scrollTop - clientHeight < 100);
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (isUserNearBottom) {
      scrollToBottom();
    }
  }, [sessions, currentSessionId, isUserNearBottom, scrollToBottom]);

  // ==================== 会话管理 ====================

  const handleCreateNewSession = useCallback(async () => {
    if (!user) {
      setError(t('chat.loginRequired', '请先登录'));
      return;
    }
    setError(''); // 清除错误提示
    const newSession = await createNewSession();
    if (newSession) {
      await updateSession(newSession.id, {
        title: t('chat.newSession', '新对话'),
        // 不设置初始模型，用户需要在首次聊天时选择
        model: '',
      });
      // 确保 isReadOnly 在更新会话后设置为 false
      setIsReadOnly(false);
    }
  }, [t, createNewSession, updateSession, user]);

  // ==================== 处理 URL 参数和会话加载 ====================

  // 处理 URL 中的会话 ID
  useEffect(() => {
    // 如果没有 URL 参数，只在首次加载且没有当前会话时处理
    if (!sessionIdFromUrl) {
      // 只在真正需要时才设置会话ID，避免干扰其他操作
      return;
    }

    // 有 URL 参数，尝试加载指定会话
    console.log(`[Chat] Loading session from URL: ${sessionIdFromUrl}`);

    // 先检查会话是否已经在列表中
    const existingSession = sessions.find((s) => s.id === sessionIdFromUrl);
    if (existingSession) {
      // 已经加载过，直接使用
      console.log(`[Chat] Session already loaded: ${sessionIdFromUrl}`);
      setCurrentSessionId(sessionIdFromUrl);
      setError('');
      return;
    }

    // 会话不在列表中，从服务器加载
    setCurrentSessionId(sessionIdFromUrl);
    loadSessionFromServer(sessionIdFromUrl)
      .then((sessionData) => {
        if (!sessionData) {
          // 会话不存在或无权限
          console.log(`[Chat] Session not found or no permission: ${sessionIdFromUrl}`);
          setError(t('chat.sessionNotFound', '会话不存在或无权限访问'));
          return;
        }

        console.log(`[Chat] Session loaded: isOwner=${sessionData.isOwner}, isReadOnly=${sessionData.isReadOnly}, messages=${sessionData.messages?.length || 0}`);
        setError(''); // 清除错误

        // 关键：添加到本地会话列表，以便 currentSession 能找到
        setSessions((prev) => [...prev, sessionData]);
      })
      .catch((err) => {
        console.error(`[Chat] Error loading session: ${err}`);
        setError(t('chat.sessionNotFound', '会话不存在或无权限访问'));
      });
  }, [sessionIdFromUrl, loadSessionFromServer]); // 移除 sessions 依赖，避免重复触发

  // 单独的 useEffect 用于初始化时自动选择会话
  useEffect(() => {
    // 只在没有 URL 参数时执行
    if (sessionIdFromUrl) {
      return;
    }

    // 如果没有当前会话，但有会话列表，选择第一个
    if (!currentSessionId && sessions.length > 0) {
      console.log(`[Chat] Auto-selecting first session: ${sessions[0].id}`);
      setCurrentSessionId(sessions[0].id);
      setError('');
    } else if (!currentSessionId && sessions.length === 0 && user) {
      // 如果没有任何会话且用户已登录，创建新会话
      console.log(`[Chat] No sessions, creating new session`);
      setError('');
      handleCreateNewSession();
    }
  }, [sessionIdFromUrl, currentSessionId, sessions.length, user, handleCreateNewSession]);

  // 监听 currentSessionId 变化，更新只读状态
  useEffect(() => {
    if (!currentSessionId) return;

    const session = sessions.find((s) => s.id === currentSessionId);
    if (!session) {
      console.log(`[Chat] Session not found in list: ${currentSessionId}`);
      return;
    }

    // 从会话数据中获取权限信息（服务器已经计算过）
    const readonly = session.isReadOnly ?? false;
    console.log(`[Chat] Session changed: id=${currentSessionId}, isReadOnly=${readonly}, messages=${session.messages?.length || 0}`);
    setIsReadOnly(readonly);
    setError('');
  }, [currentSessionId, sessions]);

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      await deleteSession(sessionId);
      setMenuAnchor(null);
    },
    [deleteSession]
  );

  const openSettings = useCallback(
    (sessionId: string) => {
      const session = sessions.find((s) => s.id === sessionId);
      if (!session) return;
      setSelectedSessionId(sessionId);
      setEditingTitle(session.title);
      setEditingSystemPrompt(session.systemPrompt);
      setEditingModel(session.model);
      setEditingApiType(session.apiType);
      setEditingStream(session.stream);
      setEditingTimeout(session.timeout || DEFAULT_TIMEOUT);
      setSettingsOpen(true);
      setMenuAnchor(null);
    },
    [sessions]
  );

  const saveSettings = useCallback(async () => {
    if (!selectedSessionId) return;
    await updateSession(selectedSessionId, {
      title: editingTitle,
      systemPrompt: editingSystemPrompt,
      model: editingModel,
      apiType: editingApiType,
      stream: editingStream,
      timeout: editingTimeout,
    });
    setSettingsOpen(false);
  }, [selectedSessionId, editingTitle, editingSystemPrompt, editingModel, editingApiType, editingStream, editingTimeout, updateSession]);

  // 快捷更新模型
  const updateCurrentModel = useCallback(
    async (modelId: string) => {
      if (!currentSessionId) return;
      await updateSession(currentSessionId, {
        model: modelId,
      });
      setModelAnchor(null);
    },
    [currentSessionId, updateSession]
  );

  // 快捷更新流式设置
  const updateCurrentStream = useCallback(
    (stream: boolean) => {
      if (!currentSessionId) return;
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id === currentSessionId) {
            return { ...s, stream, updatedAt: Date.now() };
          }
          return s;
        })
      );
    },
    [currentSessionId]
  );

  // 快捷更新超时设置
  const updateCurrentTimeout = useCallback(
    (timeout: number) => {
      if (!currentSessionId) return;
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id === currentSessionId) {
            return { ...s, timeout, updatedAt: Date.now() };
          }
          return s;
        })
      );
    },
    [currentSessionId]
  );

  // ==================== 文件处理 ====================

  const readFileAsDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const readFileAsText = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsText(file);
    });
  };

  const handleChooseFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files;
    if (!selected || selected.length === 0) return;

    if (files.length + selected.length > MAX_FILE_COUNT) {
      setError(`最多上传 ${MAX_FILE_COUNT} 个文件`);
      event.target.value = '';
      return;
    }

    const nextFiles: UploadedFile[] = [];

    for (let i = 0; i < selected.length; i++) {
      const file = selected[i];
      const isImage = ALLOWED_IMAGE_TYPES.includes(file.type);
      const isText = file.type.startsWith('text/') || file.name.endsWith('.txt') || file.name.endsWith('.md');

      if (!isImage && !isText) continue;

      const maxSize = isImage ? MAX_FILE_SIZE_IMAGE : MAX_FILE_SIZE_TEXT;
      if (file.size > maxSize) {
        setError(isImage ? '图片最大10MB' : '文件最大200MB');
        continue;
      }

      const uploaded: UploadedFile = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: file.name,
        type: file.type,
        size: file.size,
        loading: true, // 初始为加载状态
        progress: 0,
      };

      // 立即添加到列表（显示加载状态）
      nextFiles.push(uploaded);
    }

    // 立即更新状态，显示文件（带加载状态）
    setFiles((prev) => [...prev, ...nextFiles]);
    event.target.value = '';

    // 异步处理文件加载
    for (const uploaded of nextFiles) {
      const file = Array.from(selected).find(f => f.name === uploaded.name && f.size === uploaded.size);
      if (!file) continue;

      const isImage = ALLOWED_IMAGE_TYPES.includes(file.type);

      try {
        // 模拟进度更新
        setFiles((prev) => prev.map(f => f.id === uploaded.id ? { ...f, progress: 30 } : f));

        if (isImage) {
          const dataUrl = await readFileAsDataUrl(file);
          setFiles((prev) => prev.map(f => f.id === uploaded.id ? { ...f, dataUrl, progress: 60 } : f));
          
          // 如果已登录且有当前会话，上传到服务器
          if (token && currentSessionId) {
            try {
              const { uploadAttachment } = await import('../utils/attachments');
              const attachment = await uploadAttachment(
                token,
                currentSessionId,
                uploaded.id,
                file.name,
                file.type,
                dataUrl
              );
              setFiles((prev) => prev.map(f => f.id === uploaded.id ? { ...f, attachmentId: attachment.id, loading: false, progress: 100 } : f));
            } catch (error) {
              console.error('[Chat] Failed to upload attachment:', error);
              setFiles((prev) => prev.map(f => f.id === uploaded.id ? { ...f, loading: false, progress: 100 } : f));
            }
          } else {
            setFiles((prev) => prev.map(f => f.id === uploaded.id ? { ...f, loading: false, progress: 100 } : f));
          }
        } else {
          const textContent = await readFileAsText(file);
          setFiles((prev) => prev.map(f => f.id === uploaded.id ? { ...f, textContent, loading: false, progress: 100 } : f));
        }
      } catch (error) {
        console.error('[Chat] Failed to process file:', error);
        setFiles((prev) => prev.map(f => f.id === uploaded.id ? { ...f, loading: false, progress: 0 } : f));
      }
    }
  };

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  // ==================== 消息操作 ====================

  const handleCopyMessage = useCallback(async (content: string) => {
    try {
      await copyToClipboard(content);
      setSnackbar({ open: true, message: t('chat.copiedToClipboard') });
    } catch (e) {
      console.error('Failed to copy:', e);
    }
  }, [t]);

  const handleShowMessageInfo = useCallback((message: ChatMessage) => {
    setMessageInfo(message);
    setMessageInfoOpen(true);
  }, []);

  const handleDeleteMessage = useCallback(
    async (messageIndex: number) => {
      if (!currentSessionId || !token) return;
      
      // 只读模式下不允许删除消息
      if (isReadOnly) {
        return;
      }
      
      const session = sessions.find(s => s.id === currentSessionId);
      if (!session) return;
      
      const messages = [...session.messages];
      const message = messages[messageIndex];
      
      // 不允许删除 AI 的回复消息
      if (message.role === 'assistant') {
        return;
      }
      
      // 删除消息中的附件（如果有）
      if (message.files && message.files.length > 0) {
        const { deleteAttachment } = await import('../utils/attachments');
        for (const file of message.files) {
          if (file.attachmentId) {
            try {
              await deleteAttachment(token, file.attachmentId);
            } catch (error) {
              console.error('Failed to delete attachment:', error);
            }
          }
        }
      }
      
      messages.splice(messageIndex, 1);
      await updateSession(currentSessionId, { messages });
    },
    [currentSessionId, isReadOnly, sessions, updateSession, token]
  );

  const handleResendMessage = useCallback(
    async (message: ChatMessage, messageIndex: number) => {
      if (!currentSession || !token) return;
      
      // 只读模式下不允许重发消息
      if (isReadOnly) {
        return;
      }
      
      const session = sessions.find(s => s.id === currentSessionId);
      if (!session) return;
      
      const messages = session.messages.slice(0, messageIndex);
      await updateSession(currentSessionId, { messages });
      setInput(message.content);
    },
    [currentSession, currentSessionId, token, isReadOnly, sessions, updateSession]
  );

  // ==================== 队列管理 ====================

  const handleAddToQueue = useCallback(() => {
    if (!input.trim() && files.length === 0) return;
    setMessageQueue((prev) => [...prev, { input, files }]);
    setInput('');
    setFiles([]);
  }, [input, files]);

  const handlePauseStream = useCallback(() => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
      setLoading(false);
    }
  }, [abortController]);

  // 处理队列中的下一条消息
  useEffect(() => {
    if (!loading && messageQueue.length > 0 && currentSessionId) {
      const nextMessage = messageQueue[0];
      setMessageQueue((prev) => prev.slice(1));
      
      // 直接设置输入和文件
      setInput(nextMessage.input);
      setFiles(nextMessage.files);
      
      // 延迟发送，确保状态已更新
      setTimeout(() => {
        // 这里会在下一个渲染周期自动触发发送
        // 因为 input 已经被设置，sendMessage 会检查并发送
      }, 50);
    }
  }, [loading, messageQueue.length, currentSessionId]);

  // ==================== 发送消息 ====================

  const sendMessage = useCallback(async () => {
    if ((!input.trim() && files.length === 0) || !currentSession || !token) return;

    if (!currentSession.model) {
      setError('请先选择一个模型');
      return;
    }

    const modelExists = models.some((m) => m.id === currentSession.model);
    if (!modelExists) {
      setError(`模型 '${currentSession.model}' 不存在，请重新选择`);
      return;
    }

    const userMessage: ChatMessage = {
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
      files: files.length > 0 ? [...files] : undefined,
    };

    const filesForRequest = files.length > 0 ? [...files] : [];
    const session = sessions.find((s) => s.id === currentSessionId)!;
    const allMessages = [...session.messages, userMessage];

    setSessions((prev) =>
      prev.map((s) => {
        if (s.id === currentSessionId) {
          const updated = {
            ...s,
            messages: [...allMessages, { role: 'assistant' as const, content: '', timestamp: Date.now() }],
            updatedAt: Date.now(),
          };
          if (s.messages.length === 0) {
            updated.title = input.trim().substring(0, 30) + (input.trim().length > 30 ? '...' : '');
          }
          return updated;
        }
        return s;
      })
    );

    setInput('');
    setFiles([]);
    setLoading(true);
    setIsUserNearBottom(true);
    streamContentRef.current = '';

    // 创建 AbortController 用于超时控制和暂停
    const controller = new AbortController();
    setAbortController(controller);
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, (session.timeout || DEFAULT_TIMEOUT) * 1000);

    try {
      const historyMessages = session.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      let currentUserContent: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;

      if (filesForRequest.length > 0) {
        currentUserContent = [
          { type: 'text', text: userMessage.content },
          ...filesForRequest
            .filter((f) => f.dataUrl)
            .map((f) => ({
              type: 'image_url',
              image_url: { url: f.dataUrl! },
            })),
        ];
      } else {
        currentUserContent = userMessage.content;
      }

      const messagesToSend = [
        { role: 'system', content: session.systemPrompt },
        ...historyMessages,
        { role: 'user' as const, content: currentUserContent },
      ];

      const body = {
        model: session.model,
        messages: messagesToSend,
        stream: session.stream,
        sessionId: currentSessionId, // 包含会话ID以便后端自动保存消息
      };

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || 'Failed to send message');
      }

      if (session.stream) {
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        const updateContent = () => {
          setSessions((prev) =>
            prev.map((s) => {
              if (s.id === currentSessionId) {
                const messages = [...s.messages];
                const lastIndex = messages.length - 1;
                if (messages[lastIndex]) {
                  messages[lastIndex] = {
                    ...messages[lastIndex],
                    content: streamContentRef.current,
                  };
                }
                return { ...s, messages };
              }
              return s;
            })
          );
        };

        const throttledUpdate = () => {
          if (streamUpdateTimeoutRef.current === null) {
            streamUpdateTimeoutRef.current = window.setTimeout(() => {
              updateContent();
              streamUpdateTimeoutRef.current = null;
            }, 30);
          }
        };

        if (reader) {
          let buffer = '';
          let toolCalls: ToolCall[] = [];

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') continue;

                try {
                  const parsed = JSON.parse(data);
                  const delta = parsed.choices?.[0]?.delta;

                  // 处理文本内容
                  const content = delta?.content || '';
                  if (content) {
                    streamContentRef.current += content;
                    throttledUpdate();
                  }

                  // 处理工具调用
                  if (delta?.tool_calls) {
                    for (const tc of delta.tool_calls) {
                      const existingIndex = toolCalls.findIndex((t) => t.id === tc.id);
                      if (existingIndex >= 0) {
                        if (tc.function?.arguments) {
                          toolCalls[existingIndex].arguments += tc.function.arguments;
                        }
                      } else if (tc.id) {
                        toolCalls.push({
                          id: tc.id,
                          name: tc.function?.name || '',
                          arguments: tc.function?.arguments || '',
                        });
                      }
                    }
                  }
                } catch {
                  // Ignore parse errors
                }
              }
            }
          }

          if (streamUpdateTimeoutRef.current !== null) {
            clearTimeout(streamUpdateTimeoutRef.current);
            streamUpdateTimeoutRef.current = null;
          }

          // 最终更新，包含工具调用和模型信息
          setSessions((prev) =>
            prev.map((s) => {
              if (s.id === currentSessionId) {
                const messages = [...s.messages];
                const lastIndex = messages.length - 1;
                if (messages[lastIndex]) {
                  messages[lastIndex] = {
                    ...messages[lastIndex],
                    content: streamContentRef.current,
                    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                    model: session.model, // 保存模型信息
                  };
                }
                return { ...s, messages };
              }
              return s;
            })
          );
        }
      } else {
        const data = await response.json();
        const assistantContent = data.choices?.[0]?.message?.content || '';
        const toolCalls = data.choices?.[0]?.message?.tool_calls?.map((tc: any) => ({
          id: tc.id,
          name: tc.function?.name || '',
          arguments: tc.function?.arguments || '',
        }));

        setSessions((prev) =>
          prev.map((s) => {
            if (s.id === currentSessionId) {
              const messages = [...s.messages];
              const lastIndex = messages.length - 1;
              messages[lastIndex] = {
                ...messages[lastIndex],
                content: assistantContent,
                toolCalls,
                model: session.model, // 保存模型信息
                usage: data.usage, // 保存token使用量
              };
              return { ...s, messages, updatedAt: Date.now() };
            }
            return s;
          })
        );
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.error('Chat error:', err);

      // 错误处理：作为AI消息显示而不是弹窗
      const errorMessage = err.name === 'AbortError' 
        ? `请求超时（${session.timeout || DEFAULT_TIMEOUT}秒）`
        : (err.message || 'Failed to send message');

      // 将错误作为AI消息添加到会话中
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id === currentSessionId) {
            const messages = [...s.messages];
            // 替换最后一条空消息为错误消息
            if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
              messages[messages.length - 1] = {
                ...messages[messages.length - 1],
                content: `❌ **错误**: ${errorMessage}`,
              };
            }
            return { ...s, messages };
          }
          return s;
        })
      );
    } finally {
      setLoading(false);
      setAbortController(null);

      // 将更新后的会话同步到服务器
      // 使用函数式更新来获取最新的会话状态
      if (currentSessionId) {
        setSessions(prevSessions => {
          const updatedSession = prevSessions.find(s => s.id === currentSessionId);
          if (updatedSession) {
            // 同步完整的会话数据到服务器
            updateSession(currentSessionId, {
              messages: updatedSession.messages,
              title: updatedSession.title,
              model: updatedSession.model,
              systemPrompt: updatedSession.systemPrompt,
              apiType: updatedSession.apiType,
              stream: updatedSession.stream,
              timeout: updatedSession.timeout,
            }).catch(err => {
              console.error('Failed to sync session to server:', err);
            });
          }
          return prevSessions; // 返回不变的状态
        });
      }

      // 检查队列中是否有待发送的消息
      if (messageQueue.length > 0 && currentSessionId) {
        setTimeout(() => {
          // 重新触发队列处理
        }, 50);
      }
    }
  }, [input, files, currentSession, currentSessionId, token, models, sessions, messageQueue.length]);

  const handleKeyPress = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage]
  );

  // ==================== 渲染侧边�� ====================

  const drawerContent = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Button
          fullWidth
          variant="contained"
          startIcon={<Plus size={18} />}
          onClick={handleCreateNewSession}
          sx={{
            borderRadius: '12px',
            py: 1.25,
            textTransform: 'none',
            fontWeight: 500,
          }}
        >
          {t('chat.newSession', '新对话')}
        </Button>
      </Box>

      <List sx={{ flex: 1, overflowY: 'auto', py: 1, px: 1 }}>
        {sessions.map((session) => (
          <ListItem
            key={session.id}
            disablePadding
            secondaryAction={
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <IconButton
                  edge="end"
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedSessionId(session.id);
                    setMenuAnchor(e.currentTarget);
                  }}
                  sx={{ opacity: 0.6 }}
                >
                  <MoreVertical size={16} />
                </IconButton>
                <IconButton
                  edge="end"
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(t('chat.confirmDelete', '确定要删除这个对话吗？'))) {
                      handleDeleteSession(session.id);
                    }
                  }}
                  sx={{ opacity: 0.6, color: 'error.main' }}
                >
                  <Trash2 size={16} />
                </IconButton>
              </Box>
            }
            sx={{ mb: 0.5 }}
          >
            <ListItemButton
              selected={currentSessionId === session.id}
              onClick={() => {
                setCurrentSessionId(session.id);
                navigate(`/chat/${session.id}`, { replace: true }); // 更新URL
                setMobileDrawerOpen(false);
              }}
              sx={{
                borderRadius: '12px',
                pr: 7, // 为右侧按钮留出空间
                '&.Mui-selected': {
                  bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                },
              }}
            >
              <ListItemText
                primary={session.title}
                secondary={`${session.messages.length} 条消息`}
                primaryTypographyProps={{
                  noWrap: true,
                  fontWeight: currentSessionId === session.id ? 600 : 400,
                  fontSize: '0.9375rem',
                }}
                secondaryTypographyProps={{
                  noWrap: true,
                  fontSize: '0.75rem',
                }}
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Box>
  );

  // ==================== 主渲染 ====================

  return (
    <Box
      sx={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        overflow: 'hidden',
      }}
    >
      {/* 聊天区域 */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minWidth: 0,
          position: 'relative',
        }}
      >
        {/* 消息区域 - 可滚动 */}
        <Box
          id="messages-container"
          ref={messageContainerRef}
          sx={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            pt: 2,
            pb: currentSession ? '160px' : 2, // 有对话时为底部固定输入框留出空间
            bgcolor: 'background.default',
          }}
        >
          {!currentSession ? (
            <Box
              sx={{
                minHeight: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                px: 3,
              }}
            >
              <Avatar
                sx={{
                  width: 72,
                  height: 72,
                  bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
                  mb: 3,
                }}
              >
                <MessageSquare size={32} />
              </Avatar>
              <Typography variant="h5" sx={{ fontWeight: 600, mb: 1.5 }}>
                {t('chat.welcome', '开始新对话')}
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ mb: 4, maxWidth: 400 }}>
                {t('chat.welcomeDesc', '点击按钮创建新对话，开始与 AI 交流')}
              </Typography>
              <Button
                variant="contained"
                size="large"
                startIcon={<Plus size={20} />}
                onClick={handleCreateNewSession}
                sx={{ borderRadius: '12px', px: 4, py: 1.25, textTransform: 'none' }}
              >
                {t('chat.newSession', '新对话')}
              </Button>
            </Box>
          ) : (
            <Box sx={{ maxWidth: 800, mx: 'auto', width: '100%', pb: 2 }}>
              {currentSession.messages.map((message, index) => (
                <MessageBubble
                  key={`${message.timestamp}-${index}`}
                  message={message}
                  index={index}
                  isLoading={loading}
                  isLastMessage={index === currentSession.messages.length - 1}
                  isReadOnly={isReadOnly}
                  onCopy={() => handleCopyMessage(message.content)}
                  onDelete={() => handleDeleteMessage(index)}
                  onEdit={() => {
                    // TODO: 实现编辑功能
                  }}
                  onResend={() => handleResendMessage(message, index)}
                  onImagePreview={(url) => {
                    setPreviewImageUrl(url);
                    setImagePreviewOpen(true);
                  }}
                  onInfo={() => handleShowMessageInfo(message)}
                />
              ))}
              <div ref={messagesEndRef} />
            </Box>
          )}
        </Box>

        {/* 滚动按钮 */}
        {currentSession && currentSession.messages.length > 5 && (
          <Box
            sx={{
              position: 'absolute',
              right: 16,
              bottom: currentSession ? 160 : 40,
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
              zIndex: 5,
            }}
          >
            <Fab
              size="small"
              onClick={() => {
                const container = document.getElementById('messages-container');
                if (container) {
                  container.scrollTo({ top: 0, behavior: 'smooth' });
                }
              }}
              sx={{
                bgcolor: 'background.paper',
                color: 'text.primary',
                boxShadow: 2,
                '&:hover': { 
                  bgcolor: 'action.hover',
                  color: 'text.primary',
                },
              }}
            >
              <ChevronUp size={20} />
            </Fab>
            <Fab
              size="small"
              onClick={() => scrollToBottom('smooth')}
              sx={{
                bgcolor: 'background.paper',
                color: 'text.primary',
                boxShadow: 2,
                '&:hover': { 
                  bgcolor: 'action.hover',
                  color: 'text.primary',
                },
              }}
            >
              <ChevronDown size={20} />
            </Fab>
          </Box>
        )}

        {/* 错误提示 */}
        {error && (
          <Alert
            severity="error"
            onClose={() => setError('')}
            sx={{
              position: 'absolute',
              bottom: currentSession ? 140 : 20,
              left: 16,
              right: 16,
              maxWidth: 800,
              mx: 'auto',
              borderRadius: '12px',
              zIndex: 10,
            }}
          >
            {error}
          </Alert>
        )}

        {/* 固定在底部的输入区域 */}
        {currentSession && (
          <Box
            sx={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              bgcolor: 'background.paper',
              borderTop: 1,
              borderColor: 'divider',
              p: 2,
              zIndex: 5,
            }}
          >
            {/* 附件预览 */}
            {isReadOnly ? (
          <Box
            sx={{
              maxWidth: 800,
              mx: 'auto',
              bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
              borderRadius: '24px',
              p: 3,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1,
            }}
          >
            <Lock size={20} sx={{ color: 'text.secondary' }} />
            <Typography variant="body2" color="text.secondary">
              {currentSession?.isPublic 
                ? t('chat.readOnlyPublic', '只读模式（公开会话）') 
                : t('chat.readOnly', '只读模式')}
            </Typography>
          </Box>
        ) : (
          <>
            {/* 文件预览 */}
            {files.length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1.5, maxWidth: 800, mx: 'auto' }}>
                {files.map((file) => (
                  <Box key={file.id} sx={{ position: 'relative' }}>
                    {file.type.startsWith('image/') && file.dataUrl ? (
                      <>
                        <Box
                          component="img"
                          src={file.dataUrl}
                          alt={file.name}
                          sx={{
                            width: 64,
                            height: 64,
                            objectFit: 'cover',
                            borderRadius: '8px',
                            opacity: file.loading ? 0.5 : 1,
                          }}
                        />
                        {/* 进度条 */}
                        {file.loading && (
                          <Box
                            sx={{
                              position: 'absolute',
                              bottom: 0,
                              left: 0,
                              right: 0,
                              height: 4,
                              bgcolor: 'rgba(0,0,0,0.1)',
                              borderRadius: '0 0 8px 8px',
                            }}
                          >
                            <Box
                              sx={{
                                height: '100%',
                                width: `${file.progress || 0}%`,
                                bgcolor: 'primary.main',
                                borderRadius: '0 0 8px 8px',
                                transition: 'width 0.3s',
                              }}
                            />
                          </Box>
                        )}
                        {/* 加载中图标 */}
                        {file.loading && (
                          <Box
                            sx={{
                              position: 'absolute',
                              top: '50%',
                              left: '50%',
                              transform: 'translate(-50%, -50%)',
                            }}
                          >
                            <CircularProgress size={20} />
                          </Box>
                        )}
                        <IconButton
                          size="small"
                          onClick={() => removeFile(file.id)}
                          sx={{
                            position: 'absolute',
                            top: -8,
                            right: -8,
                            bgcolor: 'error.main',
                            color: 'white',
                            width: 20,
                            height: 20,
                            '&:hover': { bgcolor: 'error.dark' },
                          }}
                        >
                          <X size={12} />
                        </IconButton>
                      </>
                    ) : (
                      <Chip
                        label={file.loading ? `${file.name} (${file.progress || 0}%)` : file.name}
                        onDelete={() => removeFile(file.id)}
                        size="small"
                        icon={file.loading ? <CircularProgress size={14} /> : <Paperclip size={14} />}
                      />
                    )}
                  </Box>
                ))}
              </Box>
            )}

            {/* 输入框容器 */}
            <Box
              sx={{
                maxWidth: 800,
                mx: 'auto',
                bgcolor: 'transparent',
                borderRadius: '24px',
                border: 1,
                borderColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                overflow: 'hidden',
                boxShadow: theme.palette.mode === 'dark' 
                  ? '0 8px 32px rgba(0,0,0,0.5)' 
                  : '0 8px 32px rgba(0,0,0,0.1)',
              }}
            >
              {/* 输入框 */}
              <TextField
                fullWidth
                multiline
                maxRows={6}
                minRows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder={t('chat.inputPlaceholder', '输入消息...')}
                disabled={false}
                variant="standard"
                InputProps={{
                  disableUnderline: true,
                }}
                sx={{
                  '& .MuiInputBase-root': {
                    px: 2,
                    py: 1.5,
                    fontSize: '0.9375rem',
                  },
                }}
              />

              {/* 底部工具栏 */}
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  px: 1.5,
                  py: 1,
                  borderTop: 1,
                  borderColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  hidden
                  multiple
                  onChange={handleChooseFiles}
                  accept="image/*,.txt,.md,.json"
                />

                {/* 附件按钮 */}
                <Tooltip title={t('chat.addAttachment', '添加附件')}>
                  <IconButton
                    size="small"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={false}
                    sx={{ color: 'text.secondary' }}
                  >
                    <Paperclip size={20} />
                  </IconButton>
                </Tooltip>

                {/* 模型选择 */}
                <Tooltip title={currentSession.model || t('chat.selectModel', '选择模型')}>
                  <Chip
                    size="small"
                    label={currentSession.model || t('chat.selectModel', '选择模型')}
                    onClick={(e) => setModelAnchor(e.currentTarget)}
                    icon={<Sparkles size={14} />}
                    deleteIcon={<ChevronDown size={14} />}
                    onDelete={(e) => setModelAnchor(e.currentTarget as HTMLElement)}
                    sx={{
                      ml: 1,
                      borderRadius: '8px',
                      cursor: 'pointer',
                      maxWidth: 150,
                      opacity: currentSession.model ? 1 : 0.7,
                      '& .MuiChip-label': {
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      },
                      '& .MuiChip-deleteIcon': {
                        color: 'inherit',
                      },
                    }}
                  />
                </Tooltip>

                <Box sx={{ flex: 1 }} />

                {/* 选项按钮 */}
                <Tooltip title={t('chat.moreOptions', '更多选项')}>
                  <IconButton size="small" onClick={(e) => setOptionsAnchor(e.currentTarget)} sx={{ mr: 1 }}>
                    <Settings size={18} />
                  </IconButton>
                </Tooltip>

                {/* 发送按钮 */}
                {loading ? (
                  <>
                    {/* 队列按钮 - 当AI响应时用户输入显示 */}
                    {(input.trim() || files.length > 0) && (
                      <Tooltip title={t('chat.addToQueue', '加入队列')}>
                        <IconButton
                          onClick={handleAddToQueue}
                          sx={{
                            bgcolor: 'warning.main',
                            color: 'warning.contrastText',
                            '&:hover': { bgcolor: 'warning.dark' },
                            mr: 1,
                          }}
                        >
                          <Zap size={20} />
                        </IconButton>
                      </Tooltip>
                    )}
                    {/* 暂停按钮 */}
                    <IconButton
                      onClick={handlePauseStream}
                      sx={{
                        bgcolor: 'error.main',
                        color: 'error.contrastText',
                        '&:hover': { bgcolor: 'error.dark' },
                      }}
                    >
                      <X size={20} />
                    </IconButton>
                  </>
                ) : (
                  <IconButton
                    onClick={sendMessage}
                    disabled={!input.trim() && files.length === 0}
                    sx={{
                      bgcolor: 'primary.main',
                      color: 'primary.contrastText',
                      '&:hover': { bgcolor: 'primary.dark' },
                      '&.Mui-disabled': { bgcolor: 'action.disabledBackground', color: 'action.disabled' },
                    }}
                  >
                    <Send size={20} />
                  </IconButton>
                )}
              </Box>
            </Box>
        </>
        )}
      </Box>
        )}

      {/* 模型选择 Popover */}
      <Popover
        open={Boolean(modelAnchor)}
        anchorEl={modelAnchor}
        onClose={() => setModelAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        PaperProps={{ sx: { borderRadius: '12px', maxHeight: 300, minWidth: 200 } }}
      >
        <List dense sx={{ py: 0.5 }}>
          {models.length === 0 ? (
            <ListItem disablePadding>
              <Box sx={{ p: 2, textAlign: 'center', color: 'text.secondary', width: '100%' }}>
                <Typography variant="body2">{t('chat.noModelsConfig', '暂无可用模型')}</Typography>
                <Typography variant="caption" sx={{ display: 'block', mt: 1 }}>
                  {t('chat.selectModelOnSend', '首次发送消息时可选择模型')}
                </Typography>
              </Box>
            </ListItem>
          ) : (
            models.map((model) => (
              <ListItem key={model.id} disablePadding>
                <ListItemButton
                  selected={currentSession?.model === model.id}
                  onClick={() => updateCurrentModel(model.id)}
                  sx={{ borderRadius: '8px', mx: 0.5, my: 0.25 }}
                >
                  <ListItemText
                    primary={model.id}
                    secondary={model.context_length ? formatContextLength(model.context_length) : undefined}
                    primaryTypographyProps={{ fontSize: '0.875rem' }}
                    secondaryTypographyProps={{ fontSize: '0.75rem', color: 'text.secondary' }}
                  />
                </ListItemButton>
              </ListItem>
            ))
          )}
        </List>
      </Popover>

      {/* 选项 Popover */}
      <Popover
        open={Boolean(optionsAnchor)}
        anchorEl={optionsAnchor}
        onClose={() => setOptionsAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        PaperProps={{ sx: { borderRadius: '12px', p: 2, minWidth: 280 } }}
      >
        <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
          {t('chat.options', '选项')}
        </Typography>

        {/* 流式输出 */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <Zap size={18} style={{ marginRight: 8 }} />
          <Typography variant="body2" sx={{ flex: 1 }}>
            {t('chat.streamOutput', '流式输出')}
          </Typography>
          <Switch
            size="small"
            checked={currentSession?.stream ?? true}
            onChange={(e) => updateCurrentStream(e.target.checked)}
            disabled={isReadOnly}
          />
        </Box>

        {/* 公开会话 */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <Globe2 size={18} style={{ marginRight: 8 }} />
          <Typography variant="body2" sx={{ flex: 1 }}>
            {t('chat.publicSession', '公开会话')}
          </Typography>
          <Switch
            size="small"
            checked={currentSession?.isPublic ?? false}
            onChange={(e) => {
              if (currentSession) {
                updateSession(currentSession.id, { isPublic: e.target.checked });
              }
            }}
            disabled={isReadOnly}
          />
        </Box>

        {/* 复制会话链接 */}
        {currentSession?.isPublic && (
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <Globe size={18} style={{ marginRight: 8 }} />
            <Button
              size="small"
              onClick={async () => {
                const link = `${window.location.origin}/chat/session/${currentSession.id}`;
                try {
                  await copyToClipboard(link);
                  setSnackbar({ open: true, message: t('chat.linkCopied', '链���已复制') });
                } catch (e) {
                  console.error('Failed to copy link:', e);
                }
              }}
              sx={{
                flex: 1,
                justifyContent: 'flex-start',
                textTransform: 'none',
              }}
              startIcon={<Copy size={14} />}
            >
              {t('chat.copyLink', '复制链接')}
            </Button>
          </Box>
        )}

        <Divider sx={{ my: 1.5 }} />

        {/* 超时设置 */}
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
            <Clock size={18} style={{ marginRight: 8 }} />
            <Typography variant="body2">
              {t('chat.timeout', '超时时间')}: {currentSession?.timeout || DEFAULT_TIMEOUT}s
            </Typography>
          </Box>
          <Slider
            value={currentSession?.timeout || DEFAULT_TIMEOUT}
            onChange={(_, value) => updateCurrentTimeout(value as number)}
            min={10}
            max={300}
            step={10}
            marks={[
              { value: 10, label: '10s' },
              { value: 60, label: '60s' },
              { value: 120, label: '120s' },
              { value: 300, label: '300s' },
            ]}
            sx={{ mt: 1 }}
          />
        </Box>
      </Popover>

      {/* 菜单 */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        PaperProps={{ sx: { borderRadius: '12px', minWidth: 160 } }}
      >
        <MenuItem
          onClick={() => selectedSessionId && openSettings(selectedSessionId)}
          sx={{ borderRadius: '8px', mx: 0.5 }}
        >
          <Settings size={16} style={{ marginRight: 8 }} />
          {t('chat.settings', '设置')}
        </MenuItem>
        <MenuItem
          onClick={() => selectedSessionId && handleDeleteSession(selectedSessionId)}
          sx={{ borderRadius: '8px', mx: 0.5, color: 'error.main' }}
        >
          <Trash2 size={16} style={{ marginRight: 8 }} />
          {t('chat.delete', '删除')}
        </MenuItem>
      </Menu>

      {/* 设置对话框 */}
      <Dialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { borderRadius: '16px' } }}
      >
        <DialogTitle sx={{ fontWeight: 600 }}>{t('chat.sessionSettings', '对话设置')}</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label={t('chat.title', '标题')}
            value={editingTitle}
            onChange={(e) => setEditingTitle(e.target.value)}
            sx={{ mt: 1 }}
            variant="outlined"
          />

          <FormControl fullWidth sx={{ mt: 2 }} disabled={models.length === 0}>
            <InputLabel>{t('chat.model', '模型')}</InputLabel>
            <Select value={editingModel} label={t('chat.model', '模型')} onChange={(e) => setEditingModel(e.target.value)}>
              {models.length === 0 ? (
                <MenuItem disabled value="">
                  {t('chat.noModelsConfig', '暂无可用模型')}
                </MenuItem>
              ) : (
                models.map((model) => (
                  <MenuItem key={model.id} value={model.id}>
                    {model.id}
                  </MenuItem>
                ))
              )}
            </Select>
          </FormControl>

          <FormControl fullWidth sx={{ mt: 2 }}>
            <InputLabel>{t('chat.apiType', 'API 类型')}</InputLabel>
            <Select
              value={editingApiType}
              label={t('chat.apiType', 'API 类型')}
              onChange={(e) => setEditingApiType(e.target.value as ApiType)}
            >
              {API_TYPES.map((apiType) => (
                <MenuItem key={apiType.value} value={apiType.value}>
                  {apiType.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            fullWidth
            multiline
            rows={3}
            label={t('chat.systemPrompt', '系统提示词')}
            value={editingSystemPrompt}
            onChange={(e) => setEditingSystemPrompt(e.target.value)}
            sx={{ mt: 2 }}
            variant="outlined"
            helperText={t('chat.systemPromptHelper', '设置 AI 的角色和行为')}
          />

          <Box sx={{ mt: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
            <FormControlLabel
              control={<Switch checked={editingStream} onChange={(e) => setEditingStream(e.target.checked)} />}
              label={t('chat.stream', '流式输出')}
            />
          </Box>

          <Box sx={{ mt: 2 }}>
            <Typography variant="body2" sx={{ mb: 1 }}>
              超时时间: {editingTimeout}秒
            </Typography>
            <Slider
              value={editingTimeout}
              onChange={(_, value) => setEditingTimeout(value as number)}
              min={10}
              max={300}
              step={10}
              marks={[
                { value: 10, label: '10s' },
                { value: 60, label: '60s' },
                { value: 120, label: '120s' },
                { value: 300, label: '300s' },
              ]}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setSettingsOpen(false)} sx={{ borderRadius: '8px' }}>
            {t('common.cancel', '取消')}
          </Button>
          <Button onClick={saveSettings} variant="contained" sx={{ borderRadius: '8px' }}>
            {t('common.save', '保存')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 图片预览对话框 */}
      <Dialog
        open={imagePreviewOpen}
        onClose={() => setImagePreviewOpen(false)}
        maxWidth="lg"
        PaperProps={{ sx: { borderRadius: '16px', bgcolor: 'background.default' } }}
      >
        <Box sx={{ p: 1, display: 'flex', justifyContent: 'flex-end' }}>
          <IconButton onClick={() => setImagePreviewOpen(false)}>
            <X size={20} />
          </IconButton>
        </Box>
        <Box sx={{ p: 2, pt: 0, display: 'flex', justifyContent: 'center' }}>
          <Box
            component="img"
            src={previewImageUrl}
            alt="Preview"
            sx={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain', borderRadius: '8px' }}
          />
        </Box>
      </Dialog>

      {/* 消息信息对话框 */}
      <Dialog
        open={messageInfoOpen}
        onClose={() => setMessageInfoOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { borderRadius: '16px', bgcolor: 'background.default' } }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {t('chat.messageInfo', '消息信息')}
          <IconButton onClick={() => setMessageInfoOpen(false)}>
            <X size={20} />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {messageInfo && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  {t('chat.role', '角色')}
                </Typography>
                <Typography variant="body1">
                  {messageInfo.role === 'user' ? t('chat.user', '用户') : t('chat.assistant', 'AI助手')}
                </Typography>
              </Box>
              
              {messageInfo.model && (
                <Box>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    {t('chat.model', '模型')}
                  </Typography>
                  <Typography variant="body1" sx={{ fontFamily: 'monospace' }}>
                    {messageInfo.model}
                  </Typography>
                </Box>
              )}
              
              {messageInfo.usage && (
                <Box>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    {t('chat.tokenUsage', 'Token使用量')}
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    <Typography variant="body2">
                      {t('chat.promptTokens', '提示词')}: {messageInfo.usage.prompt_tokens}
                    </Typography>
                    <Typography variant="body2">
                      {t('chat.completionTokens', '补全')}: {messageInfo.usage.completion_tokens}
                    </Typography>
                    <Typography variant="body2">
                      {t('chat.totalTokens', '总计')}: {messageInfo.usage.total_tokens}
                    </Typography>
                  </Box>
                </Box>
              )}
              
              <Box>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  {t('chat.timestamp', '时间戳')}
                </Typography>
                <Typography variant="body1">
                  {new Date(messageInfo.timestamp).toLocaleString()}
                </Typography>
              </Box>
              
              {messageInfo.thinking && (
                <Box>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    {t('chat.thinkingProcess', '思考过程')}
                  </Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {messageInfo.thinking.substring(0, 200)}...
                  </Typography>
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
      </Dialog>
      </Box>

      {/* 桌面端侧边栏 */}
      {!isMobile && (
        <Drawer
          variant="permanent"
          anchor="right"
          sx={{
            width: DRAWER_WIDTH,
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: DRAWER_WIDTH,
              boxSizing: 'border-box',
              borderLeft: 1,
              borderColor: 'divider',
              borderRight: 'none',
              position: 'relative',
            },
          }}
        >
          {drawerContent}
        </Drawer>
      )}

      {/* 移动端抽屉 */}
      <Drawer
        variant="temporary"
        anchor="right"
        open={mobileDrawerOpen}
        onClose={() => setMobileDrawerOpen(false)}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': { width: '85%', maxWidth: 320 },
        }}
      >
        {drawerContent}
      </Drawer>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={2000}
        onClose={() => setSnackbar({ open: false, message: '' })}
        message={snackbar.message}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  );
}
