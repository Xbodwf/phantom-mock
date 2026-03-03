import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  Button,
  Slider,
  Alert,
  Snackbar,
  useTheme,
  useMediaQuery,
  Switch,
  FormControlLabel,
  Collapse,
} from '@mui/material';
import { Save } from 'lucide-react';
import { useServer } from '../contexts/ServerContext';

export default function SettingsPage() {
  const { settings, updateSettings } = useServer();
  const [streamDelay, setStreamDelay] = useState(settings.streamDelay);
  const [port, setPort] = useState(settings.port || 7143);
  const [requireApiKey, setRequireApiKey] = useState(settings.requireApiKey || false);
  const [smoothOutput, setSmoothOutput] = useState(settings.smoothOutput || false);
  const [smoothSpeed, setSmoothSpeed] = useState(settings.smoothSpeed || 20);
  const [saved, setSaved] = useState(false);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  useEffect(() => {
    setStreamDelay(settings.streamDelay);
    setPort(settings.port || 7143);
    setRequireApiKey(settings.requireApiKey || false);
    setSmoothOutput(settings.smoothOutput || false);
    setSmoothSpeed(settings.smoothSpeed || 20);
  }, [settings.streamDelay, settings.port, settings.requireApiKey, settings.smoothOutput, settings.smoothSpeed]);

  const handleSave = async () => {
    await updateSettings({ streamDelay, port, requireApiKey, smoothOutput, smoothSpeed });
    setSaved(true);
  };

  const formatDelay = (value: number) => {
    if (value < 1000) return `${value}ms`;
    return `${(value / 1000).toFixed(1)}s`;
  };

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        系统设置
      </Typography>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 600 }}>
            服务器配置
          </Typography>

          <Box sx={{ mb: 2 }}>
            <TextField
              label="API 服务器端口"
              type="number"
              value={port}
              onChange={(e) => setPort(Math.max(1, Math.min(65535, parseInt(e.target.value) || 3000)))}
              size="small"
              sx={{ width: isMobile ? '100%' : 200 }}
              inputProps={{ min: 1, max: 65535 }}
              helperText="设置后需重启服务器生效"
            />
          </Box>

          <Typography variant="caption" color="text.secondary">
            • 常用端口：3000、8080、5000<br/>
            • 修改端口后需要重启服务器才能生效<br/>
            • 如果端口被占用，服务器将无法启动<br/>
            • <strong>Docker 部署</strong>：请确保已开启对应端口的映射
          </Typography>
        </CardContent>
      </Card>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 600 }}>
            API Key 认证
          </Typography>

          <FormControlLabel
            control={
              <Switch
                checked={requireApiKey}
                onChange={(e) => setRequireApiKey(e.target.checked)}
              />
            }
            label="全局要求 API Key"
          />

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            • 开启后，所有 API 请求必须携带有效的 API Key<br/>
            • 单个模型可以设置为不需要 API Key（在模型管理中配置）<br/>
            • API Key 通过 Authorization: Bearer 或 x-api-key 头传递
          </Typography>
        </CardContent>
      </Card>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 600 }}>
            流式响应设置
          </Typography>

          {/* 平滑输出开关 */}
          <Box sx={{ mb: 3 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={smoothOutput}
                  onChange={(e) => setSmoothOutput(e.target.checked)}
                />
              }
              label="平滑输出模式"
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              启用后，用户输入的内容将逐字符发送，模拟打字效果，而非一次性发送
            </Typography>
          </Box>

          {/* 平滑输出速度设置 */}
          <Collapse in={smoothOutput}>
            <Box sx={{ mb: 3, pl: 2, borderLeft: '2px solid', borderColor: 'primary.main' }}>
              <Typography variant="body2" sx={{ mb: 1 }}>
                输出速度: {smoothSpeed} 字符/秒
              </Typography>
              <Slider
                value={smoothSpeed}
                onChange={(_, value) => setSmoothSpeed(value as number)}
                min={5}
                max={100}
                step={5}
                marks={[
                  { value: 10, label: '10' },
                  { value: 20, label: '20' },
                  { value: 50, label: '50' },
                  { value: 100, label: '100' },
                ]}
                valueLabelDisplay="auto"
              />
              <Typography variant="caption" color="text.secondary">
                每秒发送的字符数量。数值越小，输出越慢，越像真人打字。
              </Typography>
            </Box>
          </Collapse>

          {/* 延迟设置（非平滑模式时显示） */}
          <Collapse in={!smoothOutput}>
            <Box sx={{ mb: 3 }}>
              <Typography variant="body2" sx={{ mb: 1 }}>
                延迟发送时间: {formatDelay(streamDelay)}
              </Typography>
              <Slider
                value={streamDelay}
                onChange={(_, value) => setStreamDelay(value as number)}
                min={0}
                max={3000}
                step={100}
                marks={[
                  { value: 0, label: '0ms' },
                  { value: 500, label: '500ms' },
                  { value: 1000, label: '1s' },
                  { value: 2000, label: '2s' },
                  { value: 3000, label: '3s' },
                ]}
                valueLabelDisplay="auto"
                valueLabelFormat={formatDelay}
              />
              <Typography variant="caption" color="text.secondary">
                用户输入内容后，等待此时间再发送。如果在等待期间修改了内容，将重新计时。
              </Typography>
            </Box>

            <TextField
              label="延迟时间 (毫秒)"
              type="number"
              value={streamDelay}
              onChange={(e) => setStreamDelay(Math.max(0, parseInt(e.target.value) || 0))}
              size="small"
              sx={{ width: isMobile ? '100%' : 200, mb: 2 }}
              inputProps={{ min: 0, max: 10000, step: 100 }}
            />
          </Collapse>
        </CardContent>
      </Card>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 600 }}>
            使用说明
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            • <strong>即时返回模式</strong>：当延迟设为 0 时，用户输入后立即发送内容块。
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            • <strong>延迟返回模式</strong>：设置延迟后，用户输入内容会等待指定时间再发送，期间可以修改或删除内容。
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            • <strong>平滑输出模式</strong>：用户输入的内容会像打字一样逐字符发送，更加自然流畅。
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            • <strong>已发送内容</strong>：一旦内容发送成功，会以高亮样式显示，方便区分。
          </Typography>
        </CardContent>
      </Card>

      <Button
        variant="contained"
        startIcon={<Save size={18} />}
        onClick={handleSave}
        fullWidth={isMobile}
      >
        保存设置
      </Button>

      <Snackbar
        open={saved}
        autoHideDuration={2000}
        onClose={() => setSaved(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" sx={{ width: '100%' }}>
          设置已保存
        </Alert>
      </Snackbar>
    </Box>
  );
}
