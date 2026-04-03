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
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '../contexts/AuthContext';
import { useServer } from '../contexts/ServerContext';
import { useSidebar } from '../contexts/SidebarContext';
import { useTranslation } from 'react-i18next';

// ==================== 类型定义 ====================

type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  files?: UploadedFile[];
  thinking?: string;
  toolCalls?: ToolCall[];
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
};

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
  const { t } = useTranslation();
}

// ==================== 代码块组件 ====================

interface CodeBlockProps {
  className?: string;
  children: React.ReactNode;
}

const CodeBlock = memo(function CodeBlock({ className, children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const theme = useTheme();
  const codeString = String(children).replace(/\n$/, '');
  const language = className?.replace('language-', '') || '';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(codeString);
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
        fontFamily: '"Fira Code", monospace',
        fontSize: '0.875em',
        px: 0.75,
        py: 0.25,
        borderRadius: '4px',
        bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
        color: theme.palette.mode === 'dark' ? '#e879f9' : '#9333ea',
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
  const { t } = useTranslation();
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
  const { t } = useTranslation();
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

// ==================== 消息组件 ====================

interface MessageBubbleProps {
  message: ChatMessage;
  index: number;
  isLoading: boolean;
  isLastMessage: boolean;
  onCopy: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onResend: () => void;
  onImagePreview: (url: string) => void;
}

const MessageBubble = memo(function MessageBubble({
  message,
  index,
  isLoading,
  isLastMessage,
  onCopy,
  onDelete,
  onEdit,
  onResend,
  onImagePreview,
}: MessageBubbleProps) {
  const theme = useTheme();
  const isUser = message.role === 'user';
  const { t } = useTranslation();
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
                  {file.type.startsWith('image/') && file.dataUrl ? (
                    <Box
                      component="img"
                      src={file.dataUrl}
                      alt={file.name}
                      onClick={() => onImagePreview(file.dataUrl!)}
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
              borderRadius: '18px 18px 4px 18px',
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
                <IconButton size="small" onClick={onCopy} sx={{ opacity: 0.6 }}>
                  <Copy size={14} />
                </IconButton>
              </Tooltip>
              <Tooltip title="编辑">
                <IconButton size="small" onClick={onEdit} sx={{ opacity: 0.6 }}>
                  <Edit3 size={14} />
                </IconButton>
              </Tooltip>
              <Tooltip title="重发">
                <IconButton size="small" onClick={onResend} sx={{ opacity: 0.6 }}>
                  <RotateCcw size={14} />
                </IconButton>
              </Tooltip>
              <Tooltip title="删除">
                <IconButton size="small" onClick={onDelete} sx={{ opacity: 0.6 }}>
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
        <Paper
          elevation={0}
          sx={{
            px: 2,
            py: 1.5,
            borderRadius: '4px 18px 18px 18px',
            bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
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
        </Paper>

        {output && (
          <Fade in={showActions}>
            <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}>
              <Tooltip title="复制">
                <IconButton size="small" onClick={onCopy} sx={{ opacity: 0.6 }}>
                  <Copy size={14} />
                </IconButton>
              </Tooltip>
              <Tooltip title="删除">
                <IconButton size="small" onClick={onDelete} sx={{ opacity: 0.6 }}>
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
  const { t } = useTranslation();
  const { token } = useAuth();
  const { models } = useServer();
  const { toggleMobileOpen } = useSidebar();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  // 状态
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '' });

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

  // ==================== 初始化 ====================

  useEffect(() => {
    const stored = localStorage.getItem('chat-sessions');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setSessions(parsed);
        if (parsed.length > 0) {
          setCurrentSessionId(parsed[0].id);
        }
      } catch (e) {
        console.error('Failed to parse chat sessions:', e);
      }
    }
  }, []);

  useEffect(() => {
    if (sessions.length > 0) {
      localStorage.setItem('chat-sessions', JSON.stringify(sessions));
    }
  }, [sessions]);

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

  const createNewSession = useCallback(() => {
    if (!models || models.length === 0) {
      setError(t('chat.noModelsConfig'));
      return;
    }

    const newSession: ChatSession = {
      id: Date.now().toString(),
      title: t('chat.newSession', '新对话'),
      model: models[0].id,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      apiType: 'openai-chat',
      stream: true,
      timeout: DEFAULT_TIMEOUT,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    setSessions((prev) => [...prev, newSession]);
    setCurrentSessionId(newSession.id);
    setMobileDrawerOpen(false);
  }, [models, t]);

  const deleteSession = useCallback(
    (sessionId: string) => {
      const filtered = sessions.filter((s) => s.id !== sessionId);
      setSessions(filtered);
      if (currentSessionId === sessionId && filtered.length > 0) {
        setCurrentSessionId(filtered[0].id);
      } else if (currentSessionId === sessionId) {
        setCurrentSessionId(null);
      }
      setMenuAnchor(null);
    },
    [sessions, currentSessionId]
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

  const saveSettings = useCallback(() => {
    if (!selectedSessionId) return;
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id === selectedSessionId) {
          return {
            ...s,
            title: editingTitle,
            systemPrompt: editingSystemPrompt,
            model: editingModel,
            apiType: editingApiType,
            stream: editingStream,
            timeout: editingTimeout,
            updatedAt: Date.now(),
          };
        }
        return s;
      })
    );
    setSettingsOpen(false);
  }, [selectedSessionId, editingTitle, editingSystemPrompt, editingModel, editingApiType, editingStream, editingTimeout]);

  // 快捷更新模型
  const updateCurrentModel = useCallback(
    (modelId: string) => {
      if (!currentSessionId) return;
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id === currentSessionId) {
            return { ...s, model: modelId, updatedAt: Date.now() };
          }
          return s;
        })
      );
      setModelAnchor(null);
    },
    [currentSessionId]
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
      };

      if (isImage) {
        uploaded.dataUrl = await readFileAsDataUrl(file);
      } else {
        uploaded.textContent = await readFileAsText(file);
      }

      nextFiles.push(uploaded);
    }

    setFiles((prev) => [...prev, ...nextFiles]);
    event.target.value = '';
  };

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  // ==================== 消息操作 ====================

  const handleCopyMessage = useCallback(async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setSnackbar({ open: true, message: t('chat.copiedToClipboard') });
    } catch (e) {
      console.error('Failed to copy:', e);
    }
  }, []);

  const handleDeleteMessage = useCallback(
    (messageIndex: number) => {
      if (!currentSessionId) return;
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id === currentSessionId) {
            const messages = [...s.messages];
            messages.splice(messageIndex, 1);
            return { ...s, messages, updatedAt: Date.now() };
          }
          return s;
        })
      );
    },
    [currentSessionId]
  );

  const handleResendMessage = useCallback(
    (message: ChatMessage, messageIndex: number) => {
      if (!currentSession || !token) return;

      setSessions((prev) =>
        prev.map((s) => {
          if (s.id === currentSessionId) {
            const messages = s.messages.slice(0, messageIndex);
            return { ...s, messages, updatedAt: Date.now() };
          }
          return s;
        })
      );

      setInput(message.content);
    },
    [currentSession, currentSessionId, token]
  );

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

    // 创建 AbortController 用于超时控制
    const controller = new AbortController();
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

          // 最终更新，包含工具调用
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

      if (err.name === 'AbortError') {
        setError(`请求超时（${session.timeout || DEFAULT_TIMEOUT}秒）`);
      } else {
        setError(err.message || 'Failed to send message');
      }

      setSessions((prev) =>
        prev.map((s) => {
          if (s.id === currentSessionId) {
            const messages = s.messages.slice(0, -1);
            return { ...s, messages };
          }
          return s;
        })
      );
    } finally {
      setLoading(false);
    }
  }, [input, files, currentSession, currentSessionId, token, models, sessions]);

  const handleKeyPress = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage]
  );

  // ==================== 渲染侧边栏 ====================

  const drawerContent = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Button
          fullWidth
          variant="contained"
          startIcon={<Plus size={18} />}
          onClick={createNewSession}
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
              <IconButton
                edge="end"
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedSessionId(session.id);
                  setMenuAnchor(e.currentTarget);
                }}
              >
                <MoreVertical size={16} />
              </IconButton>
            }
            sx={{ mb: 0.5 }}
          >
            <ListItemButton
              selected={currentSessionId === session.id}
              onClick={() => {
                setCurrentSessionId(session.id);
                setMobileDrawerOpen(false);
              }}
              sx={{
                borderRadius: '12px',
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
        {/* 顶部栏 */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            px: 2,
            py: 1.5,
            borderBottom: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
            flexShrink: 0,
            minHeight: 56,
          }}
        >
          {/* 展开侧边栏按钮 */}
          <IconButton
            size="small"
            onClick={toggleMobileOpen}
            sx={{ mr: 1 }}
            title={t('chat.toggleSidebar', '展开/隐藏侧边栏')}
          >
            <ChevronRight size={20} />
          </IconButton>

          <Typography variant="h6" sx={{ flex: 1, fontWeight: 500, fontSize: '1.125rem' }} noWrap>
            {currentSession?.title || t('chat.selectSession', '选择对话')}
          </Typography>

          {currentSession && (
            <IconButton
              size="small"
              onClick={(e) => {
                setSelectedSessionId(currentSession.id);
                setMenuAnchor(e.currentTarget);
              }}
            >
              <MoreVertical size={20} />
            </IconButton>
          )}

          {isMobile && (
            <IconButton edge="end" onClick={() => setMobileDrawerOpen(true)} sx={{ ml: 1 }}>
              <MenuIcon size={24} />
            </IconButton>
          )}
        </Box>

        {/* 消息区域 - 可滚动 */}
        <Box
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
                onClick={createNewSession}
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
                />
              ))}
              <div ref={messagesEndRef} />
            </Box>
          )}
        </Box>

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
                          }}
                        />
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
                        label={file.name}
                        onDelete={() => removeFile(file.id)}
                        size="small"
                        icon={<Paperclip size={14} />}
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
                bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                borderRadius: '24px',
                border: 1,
                borderColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                overflow: 'hidden',
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
                disabled={loading}
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
                <Tooltip title="添加附件">
                  <IconButton
                    size="small"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={loading}
                    sx={{ color: 'text.secondary' }}
                  >
                    <Paperclip size={20} />
                  </IconButton>
                </Tooltip>

                {/* 模型选择 */}
                <Tooltip title="选择模型">
                  <Chip
                    size="small"
                    label={currentSession.model}
                    onClick={(e) => setModelAnchor(e.currentTarget)}
                    icon={<Sparkles size={14} />}
                    deleteIcon={<ChevronDown size={14} />}
                    onDelete={(e) => setModelAnchor(e.currentTarget as HTMLElement)}
                    sx={{
                      ml: 1,
                      borderRadius: '8px',
                      cursor: 'pointer',
                      '& .MuiChip-deleteIcon': {
                        color: 'inherit',
                      },
                    }}
                  />
                </Tooltip>

                {/* 选项按钮 */}
                <Tooltip title="更多选项">
                  <IconButton size="small" onClick={(e) => setOptionsAnchor(e.currentTarget)} sx={{ ml: 1 }}>
                    <Settings size={18} />
                  </IconButton>
                </Tooltip>

                <Box sx={{ flex: 1 }} />

                {/* 发送按钮 */}
                <IconButton
                  onClick={sendMessage}
                  disabled={loading || (!input.trim() && files.length === 0)}
                  sx={{
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                    '&:hover': { bgcolor: 'primary.dark' },
                    '&.Mui-disabled': { bgcolor: 'action.disabledBackground', color: 'action.disabled' },
                  }}
                >
                  {loading ? <CircularProgress size={22} color="inherit" /> : <Send size={20} />}
                </IconButton>
              </Box>
            </Box>
          </Box>
        )}
      </Box>

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
          {models.map((model) => (
            <ListItem key={model.id} disablePadding>
              <ListItemButton
                selected={currentSession?.model === model.id}
                onClick={() => updateCurrentModel(model.id)}
                sx={{ borderRadius: '8px', mx: 0.5, my: 0.25 }}
              >
                <ListItemText
                  primary={model.id}
                  primaryTypographyProps={{ fontSize: '0.875rem' }}
                />
              </ListItemButton>
            </ListItem>
          ))}
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
          快捷设置
        </Typography>

        {/* 流式输出 */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <Zap size={18} style={{ marginRight: 8 }} />
          <Typography variant="body2" sx={{ flex: 1 }}>
            流式输出
          </Typography>
          <Switch
            size="small"
            checked={currentSession?.stream ?? true}
            onChange={(e) => updateCurrentStream(e.target.checked)}
          />
        </Box>

        <Divider sx={{ my: 1.5 }} />

        {/* 超时设置 */}
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
            <Clock size={18} style={{ marginRight: 8 }} />
            <Typography variant="body2">
              超时时间: {currentSession?.timeout || DEFAULT_TIMEOUT}秒
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
          onClick={() => selectedSessionId && deleteSession(selectedSessionId)}
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

          <FormControl fullWidth sx={{ mt: 2 }}>
            <InputLabel>{t('chat.model', '模型')}</InputLabel>
            <Select value={editingModel} label={t('chat.model', '模型')} onChange={(e) => setEditingModel(e.target.value)}>
              {models.map((model) => (
                <MenuItem key={model.id} value={model.id}>
                  {model.id}
                </MenuItem>
              ))}
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
