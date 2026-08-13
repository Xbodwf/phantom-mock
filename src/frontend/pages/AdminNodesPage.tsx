import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Container,
  Box,
  Card,
  CardContent,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Stack,
  Chip,
  IconButton,
  Alert,
  Tooltip,
  Switch,
  FormControlLabel,
  InputAdornment,
  Tabs,
  Tab,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
} from '@mui/material';
import { Edit2, Trash2, Plus, Key, Search, RefreshCw, Copy, CheckCircle, XCircle, Wifi, WifiOff, Users } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { copyToClipboard } from '../utils/clipboard';
import axios from 'axios';
import type { Node, NodeGroup } from '../types';

interface NodeStatus {
  id: string;
  enabled: boolean;
  status: 'offline' | 'online';
  lastSeenAt?: number;
  tokenVersion: number;
  connected: boolean;
}

interface NodeToken {
  nodeId: string;
  tokenVersion: number;
  token: string;
}

export function AdminNodesPage() {
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const { t } = useTranslation();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // 搜索
  const [searchText, setSearchText] = useState('');

  // Node 对话框
  const [showNodeDialog, setShowNodeDialog] = useState(false);
  const [editingNode, setEditingNode] = useState<Node | null>(null);
  const [nodeForm, setNodeForm] = useState({
    id: '',
    name: '',
    description: '',
    enabled: true,
    capabilities: '',
    tags: '',
  });

  // Token 对话框
  const [showTokenDialog, setShowTokenDialog] = useState(false);
  const [tokenData, setTokenData] = useState<NodeToken | null>(null);
  const [rotatingToken, setRotatingToken] = useState(false);

  // 状态映射
  const [nodeStatuses, setNodeStatuses] = useState<Record<string, NodeStatus>>({});

  // 标签页：0=节点，1=节点组
  const [tab, setTab] = useState(0);

  // 节点组
  const [nodeGroups, setNodeGroups] = useState<NodeGroup[]>([]);
  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const [editingGroup, setEditingGroup] = useState<NodeGroup | null>(null);
  const [groupForm, setGroupForm] = useState({
    name: '',
    description: '',
    schedule: 'round-robin' as 'round-robin' | 'random' | 'priority',
    nodeIds: [] as string[],
    enabled: true,
  });

  useEffect(() => {
    if (!user || !token || user.role !== 'admin') {
      navigate('/login');
      return;
    }
    fetchNodes();
    fetchNodeGroups();
  }, [user, token, navigate]);

  const fetchNodeGroups = async () => {
    try {
      const response = await axios.get('/api/admin/node-groups', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setNodeGroups(response.data.nodeGroups || []);
    } catch (err: any) {
      console.error('Failed to fetch node groups:', err);
    }
  };

  const fetchNodes = async () => {
    try {
      const response = await axios.get('/api/admin/nodes', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const nodeList = response.data.nodes || [];
      setNodes(nodeList);
      
      // 获取每个 node 的状态
      for (const node of nodeList) {
        fetchNodeStatus(node.id);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || t('errors.failedToLoad'));
    } finally {
      setLoading(false);
    }
  };

  const fetchNodeStatus = async (nodeId: string) => {
    try {
      const response = await axios.get(`/api/admin/nodes/${nodeId}/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setNodeStatuses(prev => ({ ...prev, [nodeId]: response.data }));
    } catch {
      // ignore
    }
  };

  // Node 操作
  const handleCreateNode = () => {
    setEditingNode(null);
    setNodeForm({
      id: '',
      name: '',
      description: '',
      enabled: true,
      capabilities: '',
      tags: '',
    });
    setShowNodeDialog(true);
  };

  const handleEditNode = (node: Node) => {
    setEditingNode(node);
    setNodeForm({
      id: node.id,
      name: node.name,
      description: node.description || '',
      enabled: node.enabled,
      capabilities: (node.capabilities || []).join(', '),
      tags: (node.tags || []).join(', '),
    });
    setShowNodeDialog(true);
  };

  const handleSaveNode = async () => {
    if (!nodeForm.id || !nodeForm.name) {
      setError(t('nodes.validation.requiredFields'));
      return;
    }

    try {
      const payload = {
        id: nodeForm.id,
        name: nodeForm.name,
        description: nodeForm.description || undefined,
        enabled: nodeForm.enabled,
        capabilities: nodeForm.capabilities ? nodeForm.capabilities.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        tags: nodeForm.tags ? nodeForm.tags.split(',').map(s => s.trim()).filter(Boolean) : undefined,
      };

      if (editingNode) {
        await axios.put(
          `/api/admin/nodes/${editingNode.id}`,
          payload,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setSuccess(t('nodes.updateSuccess'));
      } else {
        const response = await axios.post(
          '/api/admin/nodes',
          payload,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        // 显示新创建节点的 key
        const newNode = response.data;
        if (newNode.key) {
          setSuccess(`${t('nodes.createSuccess')} Key: ${newNode.key}`);
        } else {
          setSuccess(t('nodes.createSuccess'));
        }
      }
      setShowNodeDialog(false);
      await fetchNodes();
    } catch (err: any) {
      setError(err.response?.data?.error || t('errors.failedToCreate'));
    }
  };

  const handleDeleteNode = async (id: string) => {
    if (!confirm(t('nodes.confirmDelete'))) return;

    try {
      await axios.delete(`/api/admin/nodes/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSuccess(t('nodes.deleteSuccess'));
      await fetchNodes();
    } catch (err: any) {
      setError(err.response?.data?.error || t('errors.failedToDelete'));
    }
  };

  // Token 操作
  const handleIssueToken = async (nodeId: string, rotate: boolean = false) => {
    setRotatingToken(true);
    try {
      const response = await axios.post(
        `/api/admin/nodes/${nodeId}/token`,
        { rotate },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setTokenData(response.data);
      setShowTokenDialog(true);
      await fetchNodes();
    } catch (err: any) {
      setError(err.response?.data?.error || t('nodes.token.failed'));
    } finally {
      setRotatingToken(false);
    }
  };

  // 节点组操作
  const handleCreateGroup = () => {
    setEditingGroup(null);
    setGroupForm({
      name: '',
      description: '',
      schedule: 'round-robin',
      nodeIds: [],
      enabled: true,
    });
    setShowGroupDialog(true);
  };

  const handleEditGroup = (group: NodeGroup) => {
    setEditingGroup(group);
    setGroupForm({
      name: group.name,
      description: group.description || '',
      schedule: group.schedule,
      nodeIds: [...group.nodeIds],
      enabled: group.enabled,
    });
    setShowGroupDialog(true);
  };

  const handleSaveGroup = async () => {
    if (!groupForm.name) {
      setError(t('nodes.group.validation.name'));
      return;
    }
    try {
      const payload = {
        name: groupForm.name,
        description: groupForm.description || undefined,
        schedule: groupForm.schedule,
        nodeIds: groupForm.nodeIds,
        enabled: groupForm.enabled,
      };
      if (editingGroup) {
        await axios.put(
          `/api/admin/node-groups/${editingGroup.id}`,
          payload,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setSuccess(t('nodes.group.updateSuccess'));
      } else {
        await axios.post(
          '/api/admin/node-groups',
          payload,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setSuccess(t('nodes.group.createSuccess'));
      }
      setShowGroupDialog(false);
      await fetchNodeGroups();
    } catch (err: any) {
      setError(err.response?.data?.error || t('errors.failedToCreate'));
    }
  };

  const handleDeleteGroup = async (id: string) => {
    if (!confirm(t('nodes.group.confirmDelete'))) return;
    try {
      await axios.delete(`/api/admin/node-groups/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSuccess(t('nodes.group.deleteSuccess'));
      await fetchNodeGroups();
    } catch (err: any) {
      setError(err.response?.data?.error || t('errors.failedToDelete'));
    }
  };

  const toggleNodeInGroup = (nodeId: string) => {
    setGroupForm(prev => {
      const has = prev.nodeIds.includes(nodeId);
      return {
        ...prev,
        nodeIds: has ? prev.nodeIds.filter(id => id !== nodeId) : [...prev.nodeIds, nodeId],
      };
    });
  };

  const copyToken = () => {
    if (tokenData?.token) {
      copyToClipboard(tokenData.token)
        .then(() => setSuccess(t('common.copied')))
        .catch(() => {});
    }
  };

  // 过滤
  const filteredNodes = nodes.filter(n =>
    n.name.toLowerCase().includes(searchText.toLowerCase()) ||
    n.id.toLowerCase().includes(searchText.toLowerCase())
  );

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 600, mb: 1 }}>
            {t('nodes.title')}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('nodes.description')}
          </Typography>
        </Box>
        <Stack direction="row" spacing={2}>
          <Button variant="outlined" onClick={() => navigate('/console/dashboard')}>
            {t('admin.backToDashboard')}
          </Button>
          <Button variant="contained" startIcon={<Plus size={18} />} onClick={handleCreateNode}>
            {t('nodes.createButton')}
          </Button>
        </Stack>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
        <Tab icon={<Wifi size={16} />} iconPosition="start" label={t('nodes.tab.nodes')} />
        <Tab icon={<Users size={16} />} iconPosition="start" label={t('nodes.tab.groups')} />
      </Tabs>

      {tab === 1 && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                {t('nodes.group.title')}
              </Typography>
              <Button variant="contained" startIcon={<Plus size={16} />} onClick={handleCreateGroup}>
                {t('nodes.group.createButton')}
              </Button>
            </Box>

            {nodeGroups.length === 0 ? (
              <Typography sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
                {t('nodes.group.noGroups')}
              </Typography>
            ) : (
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow sx={{ backgroundColor: 'action.hover' }}>
                      <TableCell>{t('common.name')}</TableCell>
                      <TableCell>{t('nodes.group.schedule')}</TableCell>
                      <TableCell>{t('nodes.group.nodes')}</TableCell>
                      <TableCell>{t('common.status')}</TableCell>
                      <TableCell align="right">{t('common.actions')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {nodeGroups.map((group) => {
                      const onlineCount = group.nodeIds.filter(id => {
                        const n = nodes.find(nn => nn.id === id);
                        return n && nodeStatuses[id]?.connected;
                      }).length;
                      return (
                        <TableRow key={group.id} hover>
                          <TableCell sx={{ fontWeight: 500 }}>{group.name}</TableCell>
                          <TableCell>
                            <Chip
                              label={group.schedule === 'round-robin' ? '轮换' : group.schedule === 'random' ? '随机' : '优先级'}
                              size="small"
                              variant="outlined"
                            />
                          </TableCell>
                          <TableCell>
                            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                              {group.nodeIds.map(nid => {
                                const n = nodes.find(nn => nn.id === nid);
                                const connected = !!nodeStatuses[nid]?.connected;
                                return (
                                  <Chip
                                    key={nid}
                                    label={n?.name || nid}
                                    size="small"
                                    color={connected ? 'success' : 'default'}
                                    variant={connected ? 'filled' : 'outlined'}
                                  />
                                );
                              })}
                              {group.nodeIds.length === 0 && (
                                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                                  {t('nodes.group.noNodesInGroup')}
                                </Typography>
                              )}
                            </Stack>
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={group.enabled ? t('common.active') : t('common.disabled')}
                              size="small"
                              color={group.enabled ? 'success' : 'error'}
                            />
                          </TableCell>
                          <TableCell align="right">
                            <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                              <IconButton size="small" onClick={() => handleEditGroup(group)}>
                                <Edit2 size={18} />
                              </IconButton>
                              <IconButton size="small" color="error" onClick={() => handleDeleteGroup(group.id)}>
                                <Trash2 size={18} />
                              </IconButton>
                            </Stack>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 0 && (
      <Card>
        <CardContent>
          <Box sx={{ mb: 3 }}>
            <TextField
              fullWidth
              placeholder={t('common.search')}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              InputProps={{
                startAdornment: <Search size={18} style={{ marginRight: 8 }} />,
              }}
              size="small"
            />
          </Box>

          {filteredNodes.length === 0 ? (
            <Typography sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
              {t('nodes.noNodes')}
            </Typography>
          ) : (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow sx={{ backgroundColor: 'action.hover' }}>
                    <TableCell>{t('common.name')}</TableCell>
                    <TableCell>{t('nodes.nodeId')}</TableCell>
                    <TableCell>{t('nodes.nodeKey')}</TableCell>
                    <TableCell>{t('common.status')}</TableCell>
                    <TableCell>{t('nodes.connectionStatus')}</TableCell>
                    <TableCell>{t('nodes.capabilities')}</TableCell>
                    <TableCell>{t('nodes.lastSeen')}</TableCell>
                    <TableCell align="right">{t('common.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredNodes.map((node) => {
                    const status = nodeStatuses[node.id];
                    const isConnected = status?.connected || false;
                    
                    return (
                      <TableRow key={node.id} hover>
                        <TableCell sx={{ fontWeight: 500 }}>{node.name}</TableCell>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{node.id}</TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={0.5} alignItems="center">
                            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {node.key ? node.key : '-'}
                            </Typography>
                            {node.key && (
                              <IconButton size="small" onClick={() => {
                                copyToClipboard(node.key!)
                                  .then(() => setSuccess(t('common.copied')))
                                  .catch(() => {});
                              }}>
                                <Copy size={14} />
                              </IconButton>
                            )}
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={node.enabled ? t('common.active') : t('common.disabled')}
                            size="small"
                            color={node.enabled ? 'success' : 'error'}
                          />
                        </TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={1} alignItems="center">
                            {isConnected ? (
                              <>
                                <Wifi size={16} color="#4caf50" />
                                <Typography variant="body2" sx={{ color: 'success.main' }}>
                                  {t('nodes.connected')}
                                </Typography>
                              </>
                            ) : (
                              <>
                                <WifiOff size={16} color="#f44336" />
                                <Typography variant="body2" sx={{ color: 'error.main' }}>
                                  {t('nodes.disconnected')}
                                </Typography>
                              </>
                            )}
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                            {(node.capabilities || []).slice(0, 3).map((cap) => (
                              <Chip key={cap} label={cap} size="small" variant="outlined" />
                            ))}
                            {(node.capabilities || []).length > 3 && (
                              <Chip
                                label={`+${(node.capabilities || []).length - 3}`}
                                size="small"
                                variant="outlined"
                              />
                            )}
                          </Stack>
                        </TableCell>
                        <TableCell>
                          {node.lastSeenAt
                            ? new Date(node.lastSeenAt).toLocaleString()
                            : t('common.never')}
                        </TableCell>
                        <TableCell align="right">
                          <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                            <Tooltip title={t('nodes.token.showToken')}>
                              <IconButton
                                size="small"
                                onClick={() => handleIssueToken(node.id, false)}
                              >
                                <Key size={18} />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title={t('nodes.token.rotateToken')}>
                              <IconButton
                                size="small"
                                onClick={() => handleIssueToken(node.id, true)}
                              >
                                <RefreshCw size={18} />
                              </IconButton>
                            </Tooltip>
                            <IconButton
                              size="small"
                              onClick={() => handleEditNode(node)}
                            >
                              <Edit2 size={18} />
                            </IconButton>
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => handleDeleteNode(node.id)}
                            >
                              <Trash2 size={18} />
                            </IconButton>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
          </CardContent>
      </Card>
      )}

      {/* Node 对话框 */}
      <Dialog open={showNodeDialog} onClose={() => setShowNodeDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingNode ? t('nodes.editTitle') : t('nodes.createTitle')}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 2 }}>
            <TextField
              fullWidth
              label={t('nodes.form.id')}
              value={nodeForm.id}
              onChange={(e) => setNodeForm({ ...nodeForm, id: e.target.value })}
              disabled={!!editingNode}
              helperText={t('nodes.form.idHelper')}
            />
            <TextField
              fullWidth
              label={t('common.name')}
              value={nodeForm.name}
              onChange={(e) => setNodeForm({ ...nodeForm, name: e.target.value })}
            />
            <TextField
              fullWidth
              label={t('common.description')}
              value={nodeForm.description}
              onChange={(e) => setNodeForm({ ...nodeForm, description: e.target.value })}
              multiline
              rows={2}
            />
            <TextField
              fullWidth
              label={t('nodes.capabilities')}
              value={nodeForm.capabilities}
              onChange={(e) => setNodeForm({ ...nodeForm, capabilities: e.target.value })}
              helperText={t('nodes.capabilitiesHelper')}
              placeholder="chat, embeddings, rerank"
            />
            <TextField
              fullWidth
              label={t('nodes.tags')}
              value={nodeForm.tags}
              onChange={(e) => setNodeForm({ ...nodeForm, tags: e.target.value })}
              helperText={t('nodes.tagsHelper')}
              placeholder="gpu, high-memory, us-west"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={nodeForm.enabled}
                  onChange={(e) => setNodeForm({ ...nodeForm, enabled: e.target.checked })}
                />
              }
              label={t('common.enabled')}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowNodeDialog(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleSaveNode}>
            {t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Token 对话框 */}
      <Dialog open={showTokenDialog} onClose={() => setShowTokenDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('nodes.token.title')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 2 }}>
            {tokenData && (
              <>
                <Alert severity="warning">
                  {t('nodes.token.warning')}
                </Alert>
                <TextField
                  fullWidth
                  label={t('nodes.token.nodeId')}
                  value={tokenData.nodeId}
                  disabled
                />
                <TextField
                  fullWidth
                  label={t('nodes.token.version')}
                  value={tokenData.tokenVersion}
                  disabled
                />
                <TextField
                  fullWidth
                  label={t('nodes.token.token')}
                  value={tokenData.token}
                  disabled
                  multiline
                  maxRows={4}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton onClick={copyToken} edge="end">
                          <Copy size={18} />
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={copyToken}>
            {t('common.copy')}
          </Button>
          <Button onClick={() => setShowTokenDialog(false)}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>

      {/* 节点组对话框 */}
      <Dialog open={showGroupDialog} onClose={() => setShowGroupDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingGroup ? t('nodes.group.editTitle') : t('nodes.group.createTitle')}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 2 }}>
            <TextField
              fullWidth
              label={t('common.name')}
              value={groupForm.name}
              onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
            />
            <TextField
              fullWidth
              label={t('common.description')}
              value={groupForm.description}
              onChange={(e) => setGroupForm({ ...groupForm, description: e.target.value })}
              multiline
              rows={2}
            />
            <FormControl fullWidth>
              <InputLabel>{t('nodes.group.schedule')}</InputLabel>
              <Select
                value={groupForm.schedule}
                label={t('nodes.group.schedule')}
                onChange={(e) => setGroupForm({ ...groupForm, schedule: e.target.value as any })}
              >
                <MenuItem value="round-robin">{t('nodes.group.scheduleRoundRobin')}</MenuItem>
                <MenuItem value="random">{t('nodes.group.scheduleRandom')}</MenuItem>
                <MenuItem value="priority">{t('nodes.group.schedulePriority')}</MenuItem>
              </Select>
            </FormControl>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              {t('nodes.group.selectNodes')}
            </Typography>
            {nodes.length === 0 ? (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {t('nodes.group.noNodesAvailable')}
              </Typography>
            ) : (
              nodes.map(node => {
                const selected = groupForm.nodeIds.includes(node.id);
                const connected = !!nodeStatuses[node.id]?.connected;
                return (
                  <Box
                    key={node.id}
                    onClick={() => toggleNodeInGroup(node.id)}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      p: 1.5,
                      borderRadius: 2,
                      border: '1px solid',
                      borderColor: selected ? 'primary.main' : 'divider',
                      cursor: 'pointer',
                      backgroundColor: selected ? 'action.selected' : 'transparent',
                      '&:hover': { backgroundColor: 'action.hover' },
                    }}
                  >
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {node.name} <span style={{ fontFamily: 'monospace', fontSize: '0.7rem', color: '#888' }}>{node.id}</span>
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {connected ? t('nodes.connected') : t('nodes.disconnected')}
                      </Typography>
                    </Box>
                    {selected ? <CheckCircle size={18} color="#4caf50" /> : <XCircle size={18} color="#bbb" />}
                  </Box>
                );
              })
            )}
            <FormControlLabel
              control={
                <Switch
                  checked={groupForm.enabled}
                  onChange={(e) => setGroupForm({ ...groupForm, enabled: e.target.checked })}
                />
              }
              label={t('common.enabled')}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowGroupDialog(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleSaveGroup}>
            {t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
