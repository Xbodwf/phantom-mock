import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';

type WebContainerStatus = 'idle' | 'booting' | 'ready' | 'error';

interface WebContainerContextType {
  status: WebContainerStatus;
  boot: () => Promise<void>;
  mount: (fileTree: any[]) => Promise<void>;
  spawn: (command: string, args?: string[]) => Promise<{ output: string; exitCode: number }>;
  terminalOutput: string[];
  clearTerminal: () => void;
}

const WebContainerContext = createContext<WebContainerContextType | undefined>(undefined);

export function WebContainerProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<WebContainerStatus>('idle');
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
  const instanceRef = useRef<any>(null);

  const boot = useCallback(async () => {
    if (status !== 'idle' && status !== 'error') return;
    setStatus('booting');
    try {
      const { WebContainer } = await import('@webcontainer/api');
      const instance = await WebContainer.boot();
      instanceRef.current = instance;
      setStatus('ready');
      console.log('[WebContainer] Booted successfully');
    } catch (e: any) {
      console.error('[WebContainer] Boot failed:', e);
      setStatus('error');
      setTerminalOutput(prev => [...prev, `[WebContainer] Boot failed: ${e.message}`]);
    }
  }, [status]);

  const mount = useCallback(async (fileTree: any[]) => {
    const instance = instanceRef.current;
    if (!instance) {
      setTerminalOutput(prev => [...prev, '[WebContainer] Not booted yet']);
      return;
    }

    // 转换 fileTree 到 WebContainer 的 tree 格式
    const toTree = (nodes: any[]): Record<string, any> => {
      const tree: Record<string, any> = {};
      for (const node of nodes) {
        if (node.type === 'directory') {
          tree[node.name] = {
            directory: toTree(node.children || []),
          };
        } else {
          tree[node.name] = {
            file: { contents: node.content || '' },
          };
        }
      }
      return tree;
    };

    try {
      await instance.fs.mount(toTree(fileTree));
      setTerminalOutput(prev => [...prev, '[WebContainer] Files mounted']);
    } catch (e: any) {
      console.error('[WebContainer] Mount failed:', e);
      setTerminalOutput(prev => [...prev, `[WebContainer] Mount failed: ${e.message}`]);
    }
  }, []);

  const spawn = useCallback(async (command: string, args?: string[]): Promise<{ output: string; exitCode: number }> => {
    const instance = instanceRef.current;
    if (!instance) {
      const msg = '[WebContainer] Not booted yet';
      setTerminalOutput(prev => [...prev, msg]);
      return { output: msg, exitCode: 1 };
    }

    setTerminalOutput(prev => [...prev, `$ ${command} ${args?.join(' ') || ''}`]);

    try {
      const process = await instance.spawn(command, args || []);
      let output = '';

      process.output.pipeTo(new WritableStream({
        write(data: string) {
          output += data;
          setTerminalOutput(prev => [...prev, data]);
        },
      }));

      const exitCode = await process.exit;
      setTerminalOutput(prev => [...prev, `[Exit: ${exitCode}]`]);
      return { output, exitCode };
    } catch (e: any) {
      const msg = `Error: ${e.message}`;
      setTerminalOutput(prev => [...prev, msg]);
      return { output: msg, exitCode: 1 };
    }
  }, []);

  const clearTerminal = useCallback(() => {
    setTerminalOutput([]);
  }, []);

  return (
    <WebContainerContext.Provider value={{ status, boot, mount, spawn, terminalOutput, clearTerminal }}>
      {children}
    </WebContainerContext.Provider>
  );
}

export function useWebContainer() {
  const ctx = useContext(WebContainerContext);
  if (!ctx) throw new Error('useWebContainer must be used within WebContainerProvider');
  return ctx;
}
