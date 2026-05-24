import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Typography,
  TextField,
  Button,
  IconButton,
  Collapse,
  Divider,
  Stack,
  Tooltip,
  Fade,
  LinearProgress,
  useTheme,
  useMediaQuery,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Paper,
  Tabs,
  Tab,
} from '@mui/material';
import {
  ChevronDown,
  Send,
  Square,
  Trash2,
  Timer,
  CheckCircle,
  Image as ImageIcon,
  Settings2,
  Video,
  Upload,
  Wrench,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useServer } from '../contexts/ServerContext';
import type { PendingRequest, MessageContent, ImageGenerationRequest, VideoGenerationRequest, ManualToolCall } from '../types';

interface RequestCardProps {
  requestId: string;
  request: PendingRequest;
}

interface SentChunk {
  content: string;
  sentAt: number;
}

// Markdown 渲染器组件
function SimpleMarkdown({ content }: { content: string }) {
  return (
    <Box className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 自定义样式以适配主题
          h1: ({ children }) => (
            <Typography variant="h5" sx={{ fontWeight: 700, mt: 2, mb: 1 }}>
              {children}
            </Typography>
          ),
          h2: ({ children }) => (
            <Typography variant="h6" sx={{ fontWeight: 600, mt: 2, mb: 1 }}>
              {children}
            </Typography>
          ),
          h3: ({ children }) => (
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mt: 1, mb: 1 }}>
              {children}
            </Typography>
          ),
          p: ({ children }) => (
            <Typography variant="body2" sx={{ mb: 1 }}>
              {children}
            </Typography>
          ),
          ul: ({ children }) => (
            <Box component="ul" sx={{ pl: 2, mb: 1 }}>
              {children}
            </Box>
          ),
          ol: ({ children }) => (
            <Box component="ol" sx={{ pl: 2, mb: 1 }}>
              {children}
            </Box>
          ),
          li: ({ children }) => (
            <Box component="li" sx={{ mb: 0.5 }}>
              {children}
            </Box>
          ),
          code: ({ inline, children }) => (
            <Box
              component="code"
              sx={{
                fontFamily: 'monospace',
                backgroundColor: 'action.hover',
                padding: '0.2em 0.4em',
                borderRadius: '4px',
                fontSize: '0.875em',
                color: 'primary.main',
              }}
            >
              {children}
            </Box>
          ),
          pre: ({ children }) => (
            <Box
              component="pre"
              sx={{
                fontFamily: 'monospace',
                backgroundColor: 'background.paper',
                padding: 2,
                borderRadius: 1,
                overflow: 'auto',
                mb: 2,
                border: '1px solid',
                borderColor: 'divider',
              }}
            >
              {children}
            </Box>
          ),
          blockquote: ({ children }) => (
            <Box
              sx={{
                borderLeft: 4,
                borderColor: 'primary.main',
                pl: 2,
                py: 1,
                mb: 1,
                fontStyle: 'italic',
                color: 'text.secondary',
              }}
            >
              {children}
            </Box>
          ),
          a: ({ href, children }) => (
            <Box
              component="a"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              sx={{
                color: 'primary.main',
                textDecoration: 'underline',
                '&:hover': { textDecoration: 'none' },
              }}
            >
              {children}
            </Box>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </Box>
  );
}

// 消息内容渲染组件
function MessageContentRenderer({ content }: { content: string | MessageContent[] }) {
  if (typeof content === 'string') {
    return <SimpleMarkdown content={content} />;
  }

  // 多模态内容
  return (
    <Stack spacing={1}>
      {content.map((item, index) => {
        if (item.type === 'text' && item.text) {
          return <SimpleMarkdown key={index} content={item.text} />;
        }

        if (item.type === 'image_url' && item.image_url) {
          const imageUrl = item.image_url.url;
          const isBase64 = imageUrl.startsWith('data:image');

          return (
            <Box
              key={index}
              sx={{
                borderRadius: 2,
                overflow: 'hidden',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                maxWidth: 300,
              }}
            >
              {isBase64 ? (
                <Box
                  component="img"
                  src={imageUrl}
                  alt="用户图片"
                  sx={{
                    width: '100%',
                    display: 'block',
                    maxHeight: 200,
                    objectFit: 'contain',
                    backgroundColor: 'rgba(0, 0, 0, 0.2)',
                  }}
                />
              ) : (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    p: 1.5,
                    backgroundColor: 'rgba(0, 0, 0, 0.2)',
                  }}
                >
                  <ImageIcon size={20} />
                  <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                    {imageUrl.length > 50 ? imageUrl.substring(0, 50) + '...' : imageUrl}
                  </Typography>
                </Box>
              )}
              {item.image_url.detail && (
                <Typography variant="caption" color="text.secondary" sx={{ p: 0.5, display: 'block' }}>
                  质量: {item.image_url.detail}
                </Typography>
              )}
            </Box>
          );
        }

        return null;
      })}
    </Stack>
  );
}

// 请求参数展示组件
function RequestParamsDisplay({ params }: { params: PendingRequest['requestParams'] }) {
  if (!params || Object.keys(params).length === 0) return null;

  const formatValue = (_key: string, value: unknown): string => {
    if (value === undefined || value === null) return '-';
    if (typeof value === 'number') return value.toString();
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
  };

  const paramLabels: Record<string, string> = {
    temperature: '温度',
    top_p: 'Top P',
    max_tokens: '最大输出',
    presence_penalty: '存在惩罚',
    frequency_penalty: '频率惩罚',
    stop: '停止词',
    n: '生成数量',
    user: '用户标识',
  };

  const paramUnits: Record<string, string> = {
    temperature: '',
    top_p: '',
    max_tokens: ' tokens',
    presence_penalty: '',
    frequency_penalty: '',
    stop: '',
    n: '',
    user: '',
  };

  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Settings2 size={12} /> 请求参数
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {Object.entries(params).map(([paramKey, value]) => {
          if (value === undefined || value === null) return null;
          return (
            <Chip
              key={paramKey}
              size="small"
              label={`${paramLabels[paramKey] || paramKey}: ${formatValue(paramKey, value)}${paramUnits[paramKey] || ''}`}
              variant="outlined"
              sx={{ height: 22, fontSize: '0.7rem' }}
            />
          );
        })}
      </Box>
    </Box>
  );
}

// 图片请求卡片
function ImageRequestCard({
  imageRequest,
  onSendImage,
  onDiscard
}: {
  imageRequest: ImageGenerationRequest;
  onSendImage: (images: Array<{ url?: string; b64_json?: string }>) => void;
  onDiscard: () => void;
}) {
  const [activeTab, setActiveTab] = useState(0);
  const [imageUrl, setImageUrl] = useState('');
  const [imageUrlList, setImageUrlList] = useState<string[]>([]);

  const handleAddUrl = () => {
    if (imageUrl.trim()) {
      setImageUrlList(prev => [...prev, imageUrl.trim()]);
      setImageUrl('');
    }
  };

  const handleRemoveUrl = (index: number) => {
    setImageUrlList(prev => prev.filter((_, i) => i !== index));
  };

  const handleSend = () => {
    if (imageUrlList.length > 0) {
      onSendImage(imageUrlList.map(url => ({ url })));
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const base64 = e.target?.result as string;
          setImageUrlList(prev => [...prev, base64]);
        };
        reader.readAsDataURL(file);
      });
    }
  };

  return (
    <Box>
      {/* 图片请求信息 */}
      <Paper sx={{ p: 2, mb: 2, backgroundColor: 'rgba(168, 199, 250, 0.05)' }}>
        <Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <ImageIcon size={16} /> 图片生成请求
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          <strong>提示词:</strong> {imageRequest.prompt}
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {imageRequest.size && <Chip size="small" label={`尺寸: ${imageRequest.size}`} />}
          {imageRequest.quality && <Chip size="small" label={`质量: ${imageRequest.quality}`} />}
          {imageRequest.style && <Chip size="small" label={`风格: ${imageRequest.style}`} />}
          {imageRequest.n && <Chip size="small" label={`数量: ${imageRequest.n}`} />}
        </Stack>
        {imageRequest.reference_image_url && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
              参考图:
            </Typography>
            <Box
              component="img"
              src={imageRequest.reference_image_url}
              alt="reference"
              sx={{ maxWidth: '100%', maxHeight: 300, borderRadius: 1, border: '1px solid', borderColor: 'divider' }}
            />
          </Box>
        )}
      </Paper>

      <Divider sx={{ my: 2 }} />

      {/* 响应方式选择 */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} variant="fullWidth">
          <Tab label="提供图片URL" />
          <Tab label="上传图片" />
        </Tabs>
      </Box>

      {activeTab === 0 && (
        <Box>
          <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="输入图片URL..."
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleAddUrl()}
            />
            <Button variant="outlined" onClick={handleAddUrl} disabled={!imageUrl.trim()}>
              添加
            </Button>
          </Stack>

          {imageUrlList.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                已添加的图片 ({imageUrlList.length})
              </Typography>
              <Stack spacing={1}>
                {imageUrlList.map((url, index) => (
                  <Box
                    key={index}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      p: 1,
                      borderRadius: 1,
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    }}
                  >
                    {url.startsWith('data:') ? (
                      <Box
                        component="img"
                        src={url}
                        alt={`图片 ${index + 1}`}
                        sx={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 1 }}
                      />
                    ) : (
                      <ImageIcon size={20} />
                    )}
                    <Typography
                      variant="body2"
                      sx={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {url.length > 50 ? url.substring(0, 50) + '...' : url}
                    </Typography>
                    <IconButton size="small" onClick={() => handleRemoveUrl(index)}>
                      <Trash2 size={16} />
                    </IconButton>
                  </Box>
                ))}
              </Stack>
            </Box>
          )}
        </Box>
      )}

      {activeTab === 1 && (
        <Box>
          <Button
            variant="outlined"
            component="label"
            fullWidth
            startIcon={<Upload size={18} />}
            sx={{ mb: 2 }}
          >
            选择图片文件
            <input
              type="file"
              hidden
              accept="image/*"
              multiple
              onChange={handleFileUpload}
            />
          </Button>

          {imageUrlList.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                已上传的图片 ({imageUrlList.length})
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {imageUrlList.map((url, index) => (
                  <Box
                    key={index}
                    sx={{
                      position: 'relative',
                      width: 80,
                      height: 80,
                    }}
                  >
                    <Box
                      component="img"
                      src={url}
                      alt={`图片 ${index + 1}`}
                      sx={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        borderRadius: 1,
                      }}
                    />
                    <IconButton
                      size="small"
                      sx={{
                        position: 'absolute',
                        top: -8,
                        right: -8,
                        backgroundColor: 'error.main',
                        '&:hover': { backgroundColor: 'error.dark' },
                      }}
                      onClick={() => handleRemoveUrl(index)}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </Box>
                ))}
              </Box>
            </Box>
          )}
        </Box>
      )}

      <Stack direction="row" spacing={1} justifyContent="flex-end">
        <Button
          variant="outlined"
          color="error"
          onClick={onDiscard}
          startIcon={<Trash2 size={16} />}
        >
          丢弃
        </Button>
        <Button
          variant="contained"
          onClick={handleSend}
          disabled={imageUrlList.length === 0}
          startIcon={<Send size={16} />}
        >
          发送 {imageUrlList.length} 张图片
        </Button>
      </Stack>
    </Box>
  );
}

// 视频请求卡片
function VideoRequestCard({
  videoRequest,
  onSendVideo,
  onDiscard
}: {
  videoRequest: VideoGenerationRequest;
  onSendVideo: (videos: Array<{ url?: string; b64_json?: string }>) => void;
  onDiscard: () => void;
}) {
  const [activeTab, setActiveTab] = useState(0);
  const [videoUrl, setVideoUrl] = useState('');
  const [videoUrlList, setVideoUrlList] = useState<string[]>([]);

  const handleAddUrl = () => {
    if (videoUrl.trim()) {
      setVideoUrlList(prev => [...prev, videoUrl.trim()]);
      setVideoUrl('');
    }
  };

  const handleRemoveUrl = (index: number) => {
    setVideoUrlList(prev => prev.filter((_, i) => i !== index));
  };

  const handleSend = () => {
    if (videoUrlList.length > 0) {
      onSendVideo(videoUrlList.map(url => ({ url })));
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const base64 = e.target?.result as string;
          setVideoUrlList(prev => [...prev, base64]);
        };
        reader.readAsDataURL(file);
      });
    }
  };

  return (
    <Box>
      {/* 视频请求信息 */}
      <Paper sx={{ p: 2, mb: 2, backgroundColor: 'rgba(129, 201, 149, 0.05)' }}>
        <Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Video size={16} /> 视频生成请求
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          <strong>提示词:</strong> {videoRequest.prompt}
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {videoRequest.duration && <Chip size="small" label={`时长: ${videoRequest.duration}秒`} />}
          {videoRequest.aspect_ratio && <Chip size="small" label={`宽高比: ${videoRequest.aspect_ratio}`} />}
          {videoRequest.size && <Chip size="small" label={`尺寸: ${videoRequest.size}`} />}
        </Stack>
      </Paper>

      <Divider sx={{ my: 2 }} />

      {/* 响应方式选择 */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} variant="fullWidth">
          <Tab label="提供视频URL" />
          <Tab label="上传视频" />
        </Tabs>
      </Box>

      {activeTab === 0 && (
        <Box>
          <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="输入视频URL..."
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleAddUrl()}
            />
            <Button variant="outlined" onClick={handleAddUrl} disabled={!videoUrl.trim()}>
              添加
            </Button>
          </Stack>

          {videoUrlList.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                已添加的视频 ({videoUrlList.length})
              </Typography>
              <Stack spacing={1}>
                {videoUrlList.map((url, index) => (
                  <Box
                    key={index}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      p: 1,
                      borderRadius: 1,
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    }}
                  >
                    <Video size={20} />
                    <Typography
                      variant="body2"
                      sx={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {url.length > 50 ? url.substring(0, 50) + '...' : url}
                    </Typography>
                    <IconButton size="small" onClick={() => handleRemoveUrl(index)}>
                      <Trash2 size={16} />
                    </IconButton>
                  </Box>
                ))}
              </Stack>
            </Box>
          )}
        </Box>
      )}

      {activeTab === 1 && (
        <Box>
          <Button
            variant="outlined"
            component="label"
            fullWidth
            startIcon={<Upload size={18} />}
            sx={{ mb: 2 }}
          >
            选择视频文件
            <input
              type="file"
              hidden
              accept="video/*"
              multiple
              onChange={handleFileUpload}
            />
          </Button>

          {videoUrlList.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                已上传的视频 ({videoUrlList.length})
              </Typography>
              <Stack spacing={1}>
                {videoUrlList.map((_, index) => (
                  <Box
                    key={index}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      p: 1,
                      borderRadius: 1,
                      backgroundColor: 'rgba(129, 201, 149, 0.1)',
                    }}
                  >
                    <Video size={20} />
                    <Typography variant="body2" sx={{ flex: 1 }}>
                      视频 {index + 1}
                    </Typography>
                    <IconButton size="small" onClick={() => handleRemoveUrl(index)}>
                      <Trash2 size={16} />
                    </IconButton>
                  </Box>
                ))}
              </Stack>
            </Box>
          )}
        </Box>
      )}

      <Stack direction="row" spacing={1} justifyContent="flex-end">
        <Button
          variant="outlined"
          color="error"
          onClick={onDiscard}
          startIcon={<Trash2 size={16} />}
        >
          丢弃
        </Button>
        <Button
          variant="contained"
          onClick={handleSend}
          disabled={videoUrlList.length === 0}
          startIcon={<Send size={16} />}
        >
          发送 {videoUrlList.length} 个视频
        </Button>
      </Stack>
    </Box>
  );
}

export default function RequestCard({ requestId, request }: RequestCardProps) {
  const { sendResponse, sendStreamChunk, endStream, sendToolCall, sendImageResponse, sendVideoResponse, removeRequest, settings } = useServer();
  const [expanded, setExpanded] = useState(true);
  const [response, setResponse] = useState('');
  const [streamInput, setStreamInput] = useState('');
  const [sentChunks, setSentChunks] = useState<SentChunk[]>([]);
  const [pendingSend, setPendingSend] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [isSmoothSending, setIsSmoothSending] = useState(false); // 平滑发送中
  const [replyMode, setReplyMode] = useState<'text' | 'tool'>('text'); // 回复模式
  const [toolCalls, setToolCalls] = useState<ManualToolCall[]>([
    { id: `call_${Date.now()}`, name: '', arguments: '' },
  ]); // 工具调用列表
  
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const smoothIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null); // 平滑发送定时器
  const smoothQueueRef = useRef<string>(''); // 待发送的字符队列
  const lastSentLengthRef = useRef<number>(0); // 已自动发送的字符数
  
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const { request: req } = request;
  const isStream = request.isStream;
  const delay = settings.streamDelay;
  const smoothOutput = settings.smoothOutput || false;
  const smoothSpeed = settings.smoothSpeed || 20; // 字符/秒
  const requestType = request.requestType || 'chat';

  // 从 JSON Schema 生成模板 JSON
  const schemaToTemplate = useCallback((schema: any): string => {
    if (!schema || schema.type !== 'object' || !schema.properties) {
      return '{}';
    }
    const template: Record<string, any> = {};
    for (const [key, prop] of Object.entries<any>(schema.properties)) {
      if (prop.type === 'string') {
        template[key] = prop.enum ? prop.enum[0] : '';
      } else if (prop.type === 'number' || prop.type === 'integer') {
        template[key] = 0;
      } else if (prop.type === 'boolean') {
        template[key] = false;
      } else if (prop.type === 'object') {
        template[key] = {};
      } else if (prop.type === 'array') {
        template[key] = [];
      } else {
        template[key] = '';
      }
    }
    return JSON.stringify(template, null, 2);
  }, []);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      if (smoothIntervalRef.current) clearInterval(smoothIntervalRef.current);
    };
  }, []);

  // 平滑发送逻辑
  const startSmoothSend = useCallback((content: string) => {
    if (!content) return;
    
    setIsSmoothSending(true);
    smoothQueueRef.current = content;
    
    const intervalMs = 1000 / smoothSpeed; // 每个字符的间隔时间
    
    smoothIntervalRef.current = setInterval(() => {
      if (smoothQueueRef.current.length === 0) {
        // 发送完成
        if (smoothIntervalRef.current) {
          clearInterval(smoothIntervalRef.current);
          smoothIntervalRef.current = null;
        }
        setIsSmoothSending(false);
        setStreamInput('');
        return;
      }
      
      // 取出要发送的字符数（每次发送1-3个字符，更自然）
      const charsToSend = Math.min(Math.ceil(Math.random() * 2) + 1, smoothQueueRef.current.length);
      const chunk = smoothQueueRef.current.substring(0, charsToSend);
      smoothQueueRef.current = smoothQueueRef.current.substring(charsToSend);
      
      sendStreamChunk(requestId, chunk);
      setSentChunks(prev => [...prev, { content: chunk, sentAt: Date.now() }]);
    }, intervalMs);
  }, [requestId, sendStreamChunk, smoothSpeed]);

  // 停止平滑发送
  const stopSmoothSend = useCallback(() => {
    if (smoothIntervalRef.current) {
      clearInterval(smoothIntervalRef.current);
      smoothIntervalRef.current = null;
    }
    setIsSmoothSending(false);
    // 发送剩余内容
    if (smoothQueueRef.current) {
      sendStreamChunk(requestId, smoothQueueRef.current);
      setSentChunks(prev => [...prev, { content: smoothQueueRef.current, sentAt: Date.now() }]);
      smoothQueueRef.current = '';
    }
    setStreamInput('');
  }, [requestId, sendStreamChunk]);

  // 倒计时效果
  useEffect(() => {
    if (pendingSend && delay > 0 && !smoothOutput) {
      const steps = Math.ceil(delay / 100);
      let currentStep = steps;
      
      setCountdown(delay);
      
      countdownRef.current = setInterval(() => {
        currentStep--;
        setCountdown((currentStep / steps) * delay);
        
        if (currentStep <= 0) {
          if (countdownRef.current) clearInterval(countdownRef.current);
        }
      }, 100);
    } else {
      setCountdown(0);
    }
  }, [pendingSend, delay, smoothOutput]);

  // 发送非流式响应
  const handleSendResponse = () => {
    if (!response.trim()) return;
    sendResponse(requestId, response);
    setResponse('');
  };

  // 发送新增字符（自动流式），不清空输入框
  const sendNewChars = useCallback((value: string) => {
    const newLen = value.length;
    if (newLen > lastSentLengthRef.current) {
      const newChars = value.substring(lastSentLengthRef.current);
      sendStreamChunk(requestId, newChars);
      setSentChunks(prev => [...prev, { content: newChars, sentAt: Date.now() }]);
      lastSentLengthRef.current = newLen;
    } else {
      lastSentLengthRef.current = newLen;
    }
  }, [requestId, sendStreamChunk]);

  // 处理流式输入变化 - 自动发送新增字符，但不清空输入框
  const handleStreamInputChange = useCallback((value: string) => {
    if (isSmoothSending) return;
    setStreamInput(value);

    if (smoothOutput) return;

    // 清除之前的延迟定时器
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setPendingSend(null);
    setCountdown(0);

    if (!value.trim()) {
      lastSentLengthRef.current = 0;
      return;
    }

    if (delay === 0) {
      sendNewChars(value);
    } else {
      setPendingSend(value);
      timerRef.current = setTimeout(() => {
        sendNewChars(value);
        setPendingSend(null);
        setCountdown(0);
        timerRef.current = null;
      }, delay);
    }
  }, [delay, isSmoothSending, smoothOutput, sendNewChars]);

  // 刷新按钮：发送剩余未自动发送的内容
  const handleFlushStream = useCallback(() => {
    if (isSmoothSending) {
      stopSmoothSend();
      return;
    }

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }

    if (streamInput.trim()) {
      sendNewChars(streamInput);
    }
    setPendingSend(null);
    setCountdown(0);
  }, [streamInput, isSmoothSending, sendNewChars, stopSmoothSend]);

  // 平滑模式下开始发送
  const handleStartSmoothSend = () => {
    if (streamInput.trim()) {
      startSmoothSend(streamInput);
    }
  };

  // 立即发送当前内容（延迟模式下点击"立即发送"）
  const handleImmediateSend = () => {
    if (isSmoothSending) {
      stopSmoothSend();
      return;
    }
    
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    
    if (streamInput.trim()) {
      sendNewChars(streamInput);
    }
    setPendingSend(null);
    setCountdown(0);
  };

  // 取消发送
  const handleCancelSend = () => {
    if (isSmoothSending) {
      if (smoothIntervalRef.current) {
        clearInterval(smoothIntervalRef.current);
        smoothIntervalRef.current = null;
      }
      setIsSmoothSending(false);
      smoothQueueRef.current = '';
      return;
    }
    
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setPendingSend(null);
    setCountdown(0);
  };

  // 结束流
  const handleEndStream = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    if (smoothIntervalRef.current) {
      clearInterval(smoothIntervalRef.current);
    }
    if (smoothQueueRef.current) {
      sendStreamChunk(requestId, smoothQueueRef.current);
      smoothQueueRef.current = '';
    }
    endStream(requestId);
  };

  // 工具调用操作
  const handleAddToolCall = useCallback(() => {
    setToolCalls(prev => [...prev, { id: `call_${Date.now()}_${prev.length}`, name: '', arguments: '' }]);
  }, []);

  const handleRemoveToolCall = useCallback((index: number) => {
    setToolCalls(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleToolCallChange = useCallback((index: number, field: 'name' | 'arguments', value: string) => {
    setToolCalls(prev => prev.map((tc, i) => i === index ? { ...tc, [field]: value } : tc));
  }, []);

  const handleSendToolCall = useCallback(() => {
    const validToolCalls = toolCalls.filter(tc => tc.name.trim());
    if (validToolCalls.length === 0) return;
    sendToolCall(requestId, validToolCalls);
  }, [toolCalls, requestId, sendToolCall]);

  // 丢弃请求
  const handleDiscard = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    if (smoothIntervalRef.current) {
      clearInterval(smoothIntervalRef.current);
    }
    removeRequest(requestId);
  };

  const roleColors: Record<string, string> = {
    system: '#ffc107',
    user: '#a8c7fa',
    assistant: '#81c995',
    tool: '#ff8b8b',
  };

  // 统计消息中的图片数量
  const imageCount = useMemo(() => {
    let count = 0;
    req.messages.forEach(msg => {
      if (typeof msg.content !== 'string' && Array.isArray(msg.content)) {
        count += msg.content.filter(c => c.type === 'image_url').length;
      }
    });
    return count;
  }, [req.messages]);

  // 获取请求类型图标和颜色
  const getTypeInfo = () => {
    switch (requestType) {
      case 'image':
        return { icon: <ImageIcon size={16} />, color: 'secondary', label: '图片生成' };
      case 'video':
        return { icon: <Video size={16} />, color: 'success', label: '视频生成' };
      default:
        return { icon: null, color: 'primary', label: '' };
    }
  };

  const typeInfo = getTypeInfo();

  // 渲染图片请求卡片
  if (requestType === 'image' && request.imageRequest) {
    return (
      <Fade in>
        <Card sx={{ mb: 2, backgroundColor: 'background.paper' }}>
          <CardHeader
            title={
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'secondary.main' }}>
                  {request.imageRequest.model}
                </Typography>
                <Chip icon={typeInfo.icon as React.ReactElement} label={typeInfo.label} size="small" color="secondary" sx={{ borderRadius: 2 }} />
              </Stack>
            }
            subheader={
              <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary', fontSize: '0.7rem' }}>
                {requestId.substring(0, 24)}...
              </Typography>
            }
            action={
              <IconButton onClick={() => setExpanded(!expanded)} size="small">
                <ChevronDown size={20} style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s' }} />
              </IconButton>
            }
            sx={{ pb: 1 }}
          />
          <Collapse in={expanded}>
            <Divider />
            <CardContent>
              <ImageRequestCard
                imageRequest={request.imageRequest}
                onSendImage={(images) => sendImageResponse(requestId, images)}
                onDiscard={handleDiscard}
              />
            </CardContent>
          </Collapse>
        </Card>
      </Fade>
    );
  }

  // 渲染视频请求卡片
  if (requestType === 'video' && request.videoRequest) {
    return (
      <Fade in>
        <Card sx={{ mb: 2, backgroundColor: 'background.paper' }}>
          <CardHeader
            title={
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'success.main' }}>
                  {request.videoRequest.model}
                </Typography>
                <Chip icon={typeInfo.icon as React.ReactElement} label={typeInfo.label} size="small" color="success" sx={{ borderRadius: 2 }} />
              </Stack>
            }
            subheader={
              <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary', fontSize: '0.7rem' }}>
                {requestId.substring(0, 24)}...
              </Typography>
            }
            action={
              <IconButton onClick={() => setExpanded(!expanded)} size="small">
                <ChevronDown size={20} style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s' }} />
              </IconButton>
            }
            sx={{ pb: 1 }}
          />
          <Collapse in={expanded}>
            <Divider />
            <CardContent>
              <VideoRequestCard
                videoRequest={request.videoRequest}
                onSendVideo={(videos) => sendVideoResponse(requestId, videos)}
                onDiscard={handleDiscard}
              />
            </CardContent>
          </Collapse>
        </Card>
      </Fade>
    );
  }

  // 渲染聊天请求卡片
  return (
    <Fade in>
      <Card 
        sx={{ 
          mb: 2,
          backgroundColor: 'background.paper',
        }}
      >
        <CardHeader
          title={
            <Stack 
              direction={isMobile ? 'column' : 'row'} 
              spacing={isMobile ? 0.5 : 1} 
              alignItems={isMobile ? 'flex-start' : 'center'}
            >
              <Typography 
                variant="subtitle1" 
                component="span"
                sx={{ 
                  fontWeight: 600,
                  color: 'primary.main',
                }}
              >
                {req.model}
              </Typography>
              <Stack direction="row" spacing={0.5}>
                <Chip
                  label={isStream ? '流式' : '非流式'}
                  size="small"
                  color={isStream ? 'warning' : 'info'}
                  sx={{ borderRadius: 2 }}
                />
                {imageCount > 0 && (
                  <Chip
                    icon={<ImageIcon size={14} />}
                    label={`${imageCount}图`}
                    size="small"
                    color="secondary"
                    sx={{ borderRadius: 2 }}
                  />
                )}
              </Stack>
            </Stack>
          }
          subheader={
            <Typography 
              variant="caption" 
              sx={{ 
                fontFamily: 'monospace',
                color: 'text.secondary',
                fontSize: '0.7rem',
              }}
            >
              {requestId.substring(0, 24)}...
            </Typography>
          }
          action={
            <Stack direction="row">
              <Tooltip title="丢弃请求">
                <IconButton onClick={handleDiscard} size="small">
                  <Trash2 size={16} />
                </IconButton>
              </Tooltip>
              <IconButton onClick={() => setExpanded(!expanded)} size="small">
                <ChevronDown
                  size={20}
                  style={{
                    transform: expanded ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.3s',
                  }}
                />
              </IconButton>
            </Stack>
          }
          sx={{ pb: 1 }}
        />
        <Collapse in={expanded}>
          <Divider />
          <CardContent>
            {/* 请求参数展示 */}
            <RequestParamsDisplay params={request.requestParams} />

            {/* 消息列表 */}
            <Accordion defaultExpanded sx={{ backgroundColor: 'transparent', boxShadow: 'none', '&:before': { display: 'none' } }}>
              <AccordionSummary expandIcon={<ChevronDown size={18} />} sx={{ px: 0, minHeight: 'auto' }}>
                <Typography variant="caption" color="text.secondary">
                  消息记录 ({req.messages.length} 条)
                </Typography>
              </AccordionSummary>
              <AccordionDetails sx={{ px: 0, pt: 0 }}>
                <Box sx={{ maxHeight: 300, overflow: 'auto' }}>
                  {req.messages.map((msg, i) => (
                    <Box
                      key={i}
                      sx={{
                        mb: 1.5,
                        p: 1.5,
                        borderRadius: 3,
                        backgroundColor: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(255, 255, 255, 0.05)',
                      }}
                    >
                      <Typography
                        variant="overline"
                        sx={{
                          color: roleColors[msg.role] || '#888',
                          fontWeight: 700,
                          display: 'block',
                          mb: 0.5,
                          fontSize: '0.65rem',
                        }}
                      >
                        {msg.role.toUpperCase()}
                      </Typography>
                      <MessageContentRenderer content={msg.content} />
                    </Box>
                  ))}
                </Box>
              </AccordionDetails>
            </Accordion>

            <Divider sx={{ my: 2 }} />

            {/* 回复模式切换 */}
            <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
              <Tabs
                value={replyMode}
                onChange={(_, v) => setReplyMode(v)}
                variant="fullWidth"
              >
                <Tab label="文本回复" value="text" />
                <Tab label="工具调用" value="tool" />
              </Tabs>
            </Box>

            {/* 工具调用模式 */}
            {replyMode === 'tool' && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Wrench size={16} /> 工具调用
                </Typography>

                {/* 客户端请求中定义的可用工具列表 */}
                {req.tools && req.tools.length > 0 && (
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                      客户端可用工具（点击自动填充函数名和参数模板）:
                    </Typography>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                      {req.tools.map((tool: any, i: number) => {
                        const fn = tool.function || tool;
                        const name = fn.name || `tool_${i}`;
                        const args = schemaToTemplate(fn.parameters);
                        return (
                          <Chip
                            key={i}
                            size="small"
                            label={name}
                            variant="outlined"
                            onClick={() => {
                              setToolCalls(prev => {
                                const next = [...prev];
                                if (next[0]) next[0] = { ...next[0], name, arguments: args };
                                return next;
                              });
                            }}
                            sx={{ cursor: 'pointer', mb: 0.5 }}
                          />
                        );
                      })}
                    </Stack>
                  </Box>
                )}
                {req.functions && req.functions.length > 0 && (
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                      客户端可用函数（已弃用，建议使用 tools）:
                    </Typography>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                      {req.functions.map((fn: any, i: number) => {
                        const name = fn.name || `func_${i}`;
                        const args = schemaToTemplate(fn.parameters);
                        return (
                          <Chip
                            key={i}
                            size="small"
                            label={name}
                            variant="outlined"
                            onClick={() => {
                              setToolCalls(prev => {
                                const next = [...prev];
                                if (next[0]) next[0] = { ...next[0], name, arguments: args };
                                return next;
                              });
                            }}
                            sx={{ cursor: 'pointer', mb: 0.5 }}
                          />
                        );
                      })}
                    </Stack>
                  </Box>
                )}

                {toolCalls.map((tc, index) => (
                  <Paper
                    key={index}
                    variant="outlined"
                    sx={{ p: 1.5, mb: 1.5, borderRadius: 2 }}
                  >
                    <Stack spacing={1.5}>
                      <TextField
                        size="small"
                        label="函数名称"
                        placeholder="如: get_weather"
                        value={tc.name}
                        onChange={(e) => handleToolCallChange(index, 'name', e.target.value)}
                        fullWidth
                      />
                      <TextField
                        size="small"
                        label="参数 (JSON)"
                        placeholder='如: {"location": "Beijing"}'
                        value={tc.arguments}
                        onChange={(e) => handleToolCallChange(index, 'arguments', e.target.value)}
                        multiline
                        minRows={2}
                        maxRows={6}
                        fullWidth
                      />
                      {toolCalls.length > 1 && (
                        <Button
                          size="small"
                          color="error"
                          variant="text"
                          onClick={() => handleRemoveToolCall(index)}
                          startIcon={<Trash2 size={14} />}
                        >
                          删除
                        </Button>
                      )}
                    </Stack>
                  </Paper>
                ))}

                <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={handleAddToolCall}
                    startIcon={<Send size={14} />}
                  >
                    添加工具调用
                  </Button>
                </Stack>

                <Button
                  variant="contained"
                  onClick={handleSendToolCall}
                  disabled={!toolCalls.some(tc => tc.name.trim())}
                  startIcon={<Wrench size={16} />}
                  fullWidth
                  color="secondary"
                >
                  发送工具调用
                </Button>
              </Box>
            )}

            {/* 文本回复模式 */}
            {replyMode === 'text' && isStream ? (
              <Box>
                {/* 已发送的内容 - 高亮显示 */}
                {sentChunks.length > 0 && (
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                      已发送内容
                    </Typography>
                    <Box
                      sx={{
                        p: 1.5,
                        borderRadius: 3,
                        backgroundColor: 'rgba(129, 201, 149, 0.1)',
                        border: '1px solid rgba(129, 201, 149, 0.3)',
                        maxHeight: 150,
                        overflow: 'auto',
                      }}
                    >
                      {sentChunks.map((chunk, i) => (
                        <Box
                          key={i}
                          sx={{
                            display: 'inline',
                            backgroundColor: 'rgba(129, 201, 149, 0.2)',
                            borderRadius: 0.5,
                            px: 0.5,
                            mr: 0.5,
                          }}
                        >
                          <Typography
                            component="span"
                            variant="body2"
                            sx={{
                              color: '#81c995',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            }}
                          >
                            {chunk.content}
                          </Typography>
                          <CheckCircle
                            size={12}
                            style={{
                              color: '#81c995',
                              marginLeft: 4,
                              verticalAlign: 'middle',
                            }}
                          />
                        </Box>
                      ))}
                    </Box>
                  </Box>
                )}

                {/* 平滑发送中的提示 */}
                {isSmoothSending && (
                  <Box sx={{ mb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <Timer size={16} style={{ color: '#a8c7fa' }} />
                      <Typography variant="caption" color="primary.main">
                        平滑输出中... ({smoothSpeed} 字符/秒)
                      </Typography>
                    </Box>
                    <LinearProgress 
                      color="primary"
                      sx={{ borderRadius: 1, height: 4 }}
                    />
                    <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                      <Button
                        size="small"
                        variant="outlined"
                        color="primary"
                        onClick={handleImmediateSend}
                      >
                        完成发送
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        color="error"
                        onClick={handleCancelSend}
                      >
                        停止
                      </Button>
                    </Stack>
                  </Box>
                )}

                {/* 延迟发送提示（非平滑模式） */}
                {pendingSend && delay > 0 && !smoothOutput && (
                  <Box sx={{ mb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <Timer size={16} style={{ color: '#ffc107' }} />
                      <Typography variant="caption" color="warning.main">
                        即时返回 - {Math.ceil(countdown / 1000)}秒后发送
                      </Typography>
                    </Box>
                    <LinearProgress 
                      variant="determinate" 
                      value={(countdown / delay) * 100} 
                      color="warning"
                      sx={{ borderRadius: 1, height: 4 }}
                    />
                    <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                      <Button
                        size="small"
                        variant="outlined"
                        color="primary"
                        onClick={handleImmediateSend}
                      >
                        立即发送
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        color="error"
                        onClick={handleCancelSend}
                      >
                        取消
                      </Button>
                    </Stack>
                  </Box>
                )}

                {/* 输入框 */}
                <TextField
                  fullWidth
                  size="small"
                  placeholder={
                    isSmoothSending ? "正在平滑输出中..." :
                    smoothOutput ? "输入完整内容后点击发送按钮" :
                    "输入要流式发送的内容..."
                  }
                  value={streamInput}
                  onChange={(e) => handleStreamInputChange(e.target.value)}
                  disabled={isSmoothSending}
                  multiline
                  maxRows={3}
                  sx={{ mb: 2 }}
                />

                <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center">
                  <Typography variant="caption" color="text.secondary">
                    {smoothOutput ? `平滑: ${smoothSpeed} 字/秒` : `延迟: ${delay}ms`} | 已发送: {sentChunks.length} 块
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    {smoothOutput && !isSmoothSending && (
                      <Button
                        variant="contained"
                        onClick={() => startSmoothSend(streamInput)}
                        disabled={!streamInput.trim()}
                        startIcon={<Send size={14} />}
                        size="small"
                      >
                        开始平滑输出
                      </Button>
                    )}
                    {!smoothOutput && (
                      <Button
                        variant="outlined"
                        onClick={handleFlushStream}
                        disabled={!streamInput.trim()}
                        startIcon={<Send size={14} />}
                        size="small"
                      >
                        刷新
                      </Button>
                    )}
                    <Button
                      variant="outlined"
                      color="error"
                      onClick={handleEndStream}
                      startIcon={<Square size={14} />}
                      size="small"
                    >
                      结束流
                    </Button>
                  </Stack>
                </Stack>
              </Box>
            ) : (
              <Box>
                <TextField
                  fullWidth
                  multiline
                  minRows={isMobile ? 2 : 3}
                  maxRows={8}
                  placeholder="输入要返回给客户端的内容... (支持 Markdown)"
                  value={response}
                  onChange={(e) => setResponse(e.target.value)}
                  sx={{ mb: 2 }}
                />
                <Button
                  variant="contained"
                  onClick={handleSendResponse}
                  disabled={!response.trim()}
                  startIcon={<Send size={16} />}
                  fullWidth={isMobile}
                >
                  发送响应
                </Button>
              </Box>
            )}
          </CardContent>
        </Collapse>
      </Card>
    </Fade>
  );
}
