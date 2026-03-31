# Phase 5: Advanced UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Production-grade canvas UX — CRDT collaborative editing, node virtualization for large graphs, LOD rendering, and enhanced minimap.

**Architecture:** Adopt n8n's Yjs CRDT pattern for collaborative editing. Implement canvas virtualization similar to React Flow Pro patterns. LOD rendering inspired by ComfyUI's zoom-based detail levels.

**Tech Stack:** React 18, @xyflow/react, Yjs, y-websocket, existing UI infrastructure

---

## File Structure

```
ui/src/
├── crdt/
│   ├── YjsProvider.ts         # Yjs document management
│   ├── AwarenessProvider.ts   # Cursor/selection awareness
│   ├── useCollaboration.ts    # React hook for collab
│   └── sync/
│       ├── WebSocketProvider.ts  # WS sync transport
│       └── GraphYDoc.ts          # Graph-specific Yjs doc
├── components/canvas/
│   ├── VirtualizedCanvas.tsx  # Virtualized node rendering
│   ├── LODNodeRenderer.tsx    # Level-of-detail node
│   └── EnhancedMinimap.tsx    # WebGL minimap fallback
├── graph/
│   ├── virtualization.ts      # Viewport culling logic
│   └── lod.ts                 # LOD level calculation
└── stores/
    └── collaborationStore.ts  # Zustand store for collab state
```

---

## Task 1: Yjs Document Setup

**Files:**
- Create: `ui/src/crdt/GraphYDoc.ts`
- Create: `ui/src/crdt/YjsProvider.ts`
- Test: `ui/src/__tests__/crdt/GraphYDoc.test.ts`

- [ ] **Step 1: Define Yjs document structure**

```typescript
// GraphYDoc.ts
import * as Y from 'yjs';

export interface YNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface YEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  data?: Record<string, unknown>;
}

export interface GraphYDoc {
  doc: Y.Doc;
  nodes: Y.Map<YNode>;
  edges: Y.Map<YEdge>;
  metadata: Y.Map<unknown>;
  
  // Operations
  addNode(node: YNode): void;
  updateNode(id: string, updates: Partial<YNode>): void;
  removeNode(id: string): void;
  addEdge(edge: YEdge): void;
  removeEdge(id: string): void;
  
  // Serialization
  toJSON(): { nodes: YNode[]; edges: YEdge[]; metadata: Record<string, unknown> };
  fromJSON(data: { nodes: YNode[]; edges: YEdge[]; metadata?: Record<string, unknown> }): void;
}

export function createGraphYDoc(): GraphYDoc {
  const doc = new Y.Doc();
  const nodes = doc.getMap<YNode>('nodes');
  const edges = doc.getMap<YEdge>('edges');
  const metadata = doc.getMap<unknown>('metadata');
  
  return {
    doc,
    nodes,
    edges,
    metadata,
    
    addNode(node: YNode) {
      nodes.set(node.id, node);
    },
    
    updateNode(id: string, updates: Partial<YNode>) {
      const existing = nodes.get(id);
      if (existing) {
        nodes.set(id, { ...existing, ...updates });
      }
    },
    
    removeNode(id: string) {
      nodes.delete(id);
      // Remove connected edges
      edges.forEach((edge, edgeId) => {
        if (edge.source === id || edge.target === id) {
          edges.delete(edgeId);
        }
      });
    },
    
    addEdge(edge: YEdge) {
      edges.set(edge.id, edge);
    },
    
    removeEdge(id: string) {
      edges.delete(id);
    },
    
    toJSON() {
      return {
        nodes: Array.from(nodes.values()),
        edges: Array.from(edges.values()),
        metadata: Object.fromEntries(metadata.entries()),
      };
    },
    
    fromJSON(data) {
      doc.transact(() => {
        nodes.clear();
        edges.clear();
        metadata.clear();
        
        data.nodes.forEach(node => nodes.set(node.id, node));
        data.edges.forEach(edge => edges.set(edge.id, edge));
        if (data.metadata) {
          Object.entries(data.metadata).forEach(([k, v]) => metadata.set(k, v));
        }
      });
    },
  };
}
```

- [ ] **Step 2: Write tests**

```typescript
// GraphYDoc.test.ts
import { createGraphYDoc } from '../GraphYDoc';

describe('GraphYDoc', () => {
  it('should create empty document', () => {
    const doc = createGraphYDoc();
    expect(doc.nodes.size).toBe(0);
    expect(doc.edges.size).toBe(0);
  });
  
  it('should add and remove nodes', () => {
    const doc = createGraphYDoc();
    
    doc.addNode({ id: 'n1', type: 'task', position: { x: 0, y: 0 }, data: {} });
    expect(doc.nodes.size).toBe(1);
    
    doc.removeNode('n1');
    expect(doc.nodes.size).toBe(0);
  });
  
  it('should remove edges when node is deleted', () => {
    const doc = createGraphYDoc();
    
    doc.addNode({ id: 'n1', type: 'task', position: { x: 0, y: 0 }, data: {} });
    doc.addNode({ id: 'n2', type: 'task', position: { x: 100, y: 0 }, data: {} });
    doc.addEdge({ id: 'e1', source: 'n1', target: 'n2' });
    
    expect(doc.edges.size).toBe(1);
    
    doc.removeNode('n1');
    expect(doc.edges.size).toBe(0);
  });
  
  it('should serialize to JSON', () => {
    const doc = createGraphYDoc();
    doc.addNode({ id: 'n1', type: 'start', position: { x: 0, y: 0 }, data: {} });
    
    const json = doc.toJSON();
    expect(json.nodes).toHaveLength(1);
    expect(json.nodes[0].id).toBe('n1');
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npm test -- GraphYDoc.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add ui/src/crdt/
git commit -m "feat(crdt): add Yjs document structure for collaborative editing"
```

---

## Task 2: Yjs Provider and React Hook

**Files:**
- Modify: `ui/src/crdt/YjsProvider.ts`
- Create: `ui/src/crdt/useCollaboration.ts`
- Test: `ui/src/__tests__/crdt/useCollaboration.test.ts`

- [ ] **Step 1: Create provider**

```typescript
// YjsProvider.ts
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { createGraphYDoc, GraphYDoc } from './GraphYDoc';

export interface YjsProviderConfig {
  serverUrl: string;
  roomName: string;
  doc?: Y.Doc;
}

export class YjsProvider {
  private doc: GraphYDoc;
  private wsProvider: WebsocketProvider | null = null;
  private roomName: string;
  private serverUrl: string;
  
  constructor(config: YjsProviderConfig) {
    this.serverUrl = config.serverUrl;
    this.roomName = config.roomName;
    this.doc = createGraphYDoc();
  }
  
  connect(): void {
    this.wsProvider = new WebsocketProvider(
      this.serverUrl,
      this.roomName,
      this.doc.doc
    );
    
    this.wsProvider.on('status', (event: { status: string }) => {
      console.log('CRDT sync status:', event.status);
    });
  }
  
  disconnect(): void {
    this.wsProvider?.disconnect();
    this.wsProvider = null;
  }
  
  get connected(): boolean {
    return this.wsProvider?.wsconnected ?? false;
  }
  
  get graphDoc(): GraphYDoc {
    return this.doc;
  }
  
  get awareness() {
    return this.wsProvider?.awareness;
  }
}
```

- [ ] **Step 2: Create React hook**

```typescript
// useCollaboration.ts
import { useEffect, useState, useCallback, useMemo } from 'react';
import { YjsProvider } from './YjsProvider';
import { GraphYDoc, YNode, YEdge } from './GraphYDoc';

export interface CollaborationState {
  connected: boolean;
  syncing: boolean;
  users: CollaboratorInfo[];
}

export interface CollaboratorInfo {
  id: number;
  name: string;
  color: string;
  cursor?: { x: number; y: number };
  selectedNodes?: string[];
}

export function useCollaboration(
  serverUrl: string,
  graphId: string,
  userId: string,
  userName: string,
) {
  const [provider, setProvider] = useState<YjsProvider | null>(null);
  const [state, setState] = useState<CollaborationState>({
    connected: false,
    syncing: false,
    users: [],
  });
  
  // Initialize provider
  useEffect(() => {
    const p = new YjsProvider({
      serverUrl,
      roomName: `graph:${graphId}`,
    });
    
    p.connect();
    setProvider(p);
    
    // Set local user info in awareness
    const awareness = p.awareness;
    if (awareness) {
      awareness.setLocalStateField('user', {
        name: userName,
        color: generateUserColor(userId),
      });
      
      // Listen for awareness changes
      awareness.on('change', () => {
        const users: CollaboratorInfo[] = [];
        awareness.getStates().forEach((state, clientId) => {
          if (state.user) {
            users.push({
              id: clientId,
              name: state.user.name,
              color: state.user.color,
              cursor: state.cursor,
              selectedNodes: state.selectedNodes,
            });
          }
        });
        setState(s => ({ ...s, users }));
      });
    }
    
    return () => {
      p.disconnect();
    };
  }, [serverUrl, graphId, userId, userName]);
  
  // Update connection state
  useEffect(() => {
    if (!provider) return;
    
    const checkConnection = () => {
      setState(s => ({ ...s, connected: provider.connected }));
    };
    
    const interval = setInterval(checkConnection, 1000);
    return () => clearInterval(interval);
  }, [provider]);
  
  // Callbacks for graph operations
  const addNode = useCallback((node: YNode) => {
    provider?.graphDoc.addNode(node);
  }, [provider]);
  
  const updateNode = useCallback((id: string, updates: Partial<YNode>) => {
    provider?.graphDoc.updateNode(id, updates);
  }, [provider]);
  
  const removeNode = useCallback((id: string) => {
    provider?.graphDoc.removeNode(id);
  }, [provider]);
  
  const addEdge = useCallback((edge: YEdge) => {
    provider?.graphDoc.addEdge(edge);
  }, [provider]);
  
  const removeEdge = useCallback((id: string) => {
    provider?.graphDoc.removeEdge(id);
  }, [provider]);
  
  // Update cursor position
  const updateCursor = useCallback((x: number, y: number) => {
    provider?.awareness?.setLocalStateField('cursor', { x, y });
  }, [provider]);
  
  // Update selection
  const updateSelection = useCallback((nodeIds: string[]) => {
    provider?.awareness?.setLocalStateField('selectedNodes', nodeIds);
  }, [provider]);
  
  return {
    state,
    graphDoc: provider?.graphDoc ?? null,
    addNode,
    updateNode,
    removeNode,
    addEdge,
    removeEdge,
    updateCursor,
    updateSelection,
  };
}

function generateUserColor(userId: string): string {
  // Generate consistent color from user ID
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 70%, 50%)`;
}
```

- [ ] **Step 3: Tests pass**

- [ ] **Step 4: Commit**

```bash
git add ui/src/crdt/
git commit -m "feat(crdt): add Yjs provider and useCollaboration hook"
```

---

## Task 3: Awareness Provider (Cursors/Selection)

**Files:**
- Create: `ui/src/crdt/AwarenessProvider.ts`
- Create: `ui/src/components/canvas/RemoteCursors.tsx`
- Test: `ui/src/__tests__/components/RemoteCursors.test.tsx`

- [ ] **Step 1: Create awareness provider**

```typescript
// AwarenessProvider.ts
import { Awareness } from 'y-protocols/awareness';
import { CollaboratorInfo } from './useCollaboration';

export interface AwarenessState {
  user?: {
    name: string;
    color: string;
  };
  cursor?: {
    x: number;
    y: number;
  };
  selectedNodes?: string[];
  viewportCenter?: {
    x: number;
    y: number;
    zoom: number;
  };
}

export function createAwarenessProvider(awareness: Awareness) {
  return {
    setUser(name: string, color: string) {
      awareness.setLocalStateField('user', { name, color });
    },
    
    setCursor(x: number, y: number) {
      awareness.setLocalStateField('cursor', { x, y });
    },
    
    clearCursor() {
      awareness.setLocalStateField('cursor', null);
    },
    
    setSelectedNodes(nodeIds: string[]) {
      awareness.setLocalStateField('selectedNodes', nodeIds);
    },
    
    setViewport(x: number, y: number, zoom: number) {
      awareness.setLocalStateField('viewportCenter', { x, y, zoom });
    },
    
    getCollaborators(): CollaboratorInfo[] {
      const collaborators: CollaboratorInfo[] = [];
      const localClientId = awareness.clientID;
      
      awareness.getStates().forEach((state: AwarenessState, clientId) => {
        if (clientId !== localClientId && state.user) {
          collaborators.push({
            id: clientId,
            name: state.user.name,
            color: state.user.color,
            cursor: state.cursor,
            selectedNodes: state.selectedNodes,
          });
        }
      });
      
      return collaborators;
    },
    
    onUpdate(callback: (collaborators: CollaboratorInfo[]) => void) {
      const handler = () => callback(this.getCollaborators());
      awareness.on('change', handler);
      return () => awareness.off('change', handler);
    },
  };
}
```

- [ ] **Step 2: Create remote cursors component**

```tsx
// RemoteCursors.tsx
import React, { useMemo } from 'react';
import { useViewport } from '@xyflow/react';
import { CollaboratorInfo } from '../../crdt/useCollaboration';

interface RemoteCursorsProps {
  collaborators: CollaboratorInfo[];
}

export function RemoteCursors({ collaborators }: RemoteCursorsProps) {
  const { x: vpX, y: vpY, zoom } = useViewport();
  
  const cursorsWithScreenPosition = useMemo(() => {
    return collaborators
      .filter(c => c.cursor)
      .map(c => ({
        ...c,
        screenX: (c.cursor!.x - vpX) * zoom,
        screenY: (c.cursor!.y - vpY) * zoom,
      }));
  }, [collaborators, vpX, vpY, zoom]);
  
  return (
    <div className="remote-cursors">
      {cursorsWithScreenPosition.map(collab => (
        <div
          key={collab.id}
          className="remote-cursor"
          style={{
            transform: `translate(${collab.screenX}px, ${collab.screenY}px)`,
          }}
        >
          <CursorIcon color={collab.color} />
          <span
            className="cursor-label"
            style={{ backgroundColor: collab.color }}
          >
            {collab.name}
          </span>
        </div>
      ))}
    </div>
  );
}

function CursorIcon({ color }: { color: string }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill={color}
      style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))' }}
    >
      <path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87c.48 0 .73-.58.39-.91L5.94 2.91a.5.5 0 0 0-.44.3z" />
    </svg>
  );
}
```

- [ ] **Step 3: Add styles**

```css
/* In canvas styles */
.remote-cursors {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 1000;
}

.remote-cursor {
  position: absolute;
  transition: transform 50ms ease-out;
}

.cursor-label {
  position: absolute;
  top: 20px;
  left: 10px;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 11px;
  color: white;
  white-space: nowrap;
}
```

- [ ] **Step 4: Commit**

```bash
git add ui/src/crdt/ ui/src/components/canvas/
git commit -m "feat(crdt): add awareness provider and remote cursors"
```

---

## Task 4: Virtualization Logic

**Files:**
- Create: `ui/src/graph/virtualization.ts`
- Test: `ui/src/__tests__/graph/virtualization.test.ts`

- [ ] **Step 1: Implement viewport culling**

```typescript
// virtualization.ts

export interface ViewportBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
}

export interface NodeBounds {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CullingResult {
  visibleNodes: string[];
  nearbyNodes: string[];  // Just outside viewport, for preloading
  hiddenNodes: string[];
}

/**
 * Calculate which nodes are visible in the viewport.
 * 
 * Pattern: Similar to React Flow Pro's virtualization.
 */
export function calculateVisibleNodes(
  nodes: NodeBounds[],
  viewport: ViewportBounds,
  overscan: number = 200,  // Extra pixels around viewport
): CullingResult {
  const visibleNodes: string[] = [];
  const nearbyNodes: string[] = [];
  const hiddenNodes: string[] = [];
  
  // Calculate viewport bounds in graph coordinates
  const viewLeft = viewport.x - overscan / viewport.zoom;
  const viewTop = viewport.y - overscan / viewport.zoom;
  const viewRight = viewport.x + (viewport.width + overscan) / viewport.zoom;
  const viewBottom = viewport.y + (viewport.height + overscan) / viewport.zoom;
  
  // Nearby zone (larger overscan)
  const nearbyOverscan = overscan * 2;
  const nearbyLeft = viewport.x - nearbyOverscan / viewport.zoom;
  const nearbyTop = viewport.y - nearbyOverscan / viewport.zoom;
  const nearbyRight = viewport.x + (viewport.width + nearbyOverscan) / viewport.zoom;
  const nearbyBottom = viewport.y + (viewport.height + nearbyOverscan) / viewport.zoom;
  
  for (const node of nodes) {
    const nodeRight = node.x + node.width;
    const nodeBottom = node.y + node.height;
    
    // Check if node intersects viewport
    const isVisible = !(
      nodeRight < viewLeft ||
      node.x > viewRight ||
      nodeBottom < viewTop ||
      node.y > viewBottom
    );
    
    if (isVisible) {
      visibleNodes.push(node.id);
      continue;
    }
    
    // Check if node is nearby
    const isNearby = !(
      nodeRight < nearbyLeft ||
      node.x > nearbyRight ||
      nodeBottom < nearbyTop ||
      node.y > nearbyBottom
    );
    
    if (isNearby) {
      nearbyNodes.push(node.id);
    } else {
      hiddenNodes.push(node.id);
    }
  }
  
  return { visibleNodes, nearbyNodes, hiddenNodes };
}

/**
 * Calculate Level of Detail based on zoom level.
 */
export type LODLevel = 'full' | 'simplified' | 'minimal' | 'dot';

export function calculateLODLevel(zoom: number): LODLevel {
  if (zoom >= 0.5) return 'full';
  if (zoom >= 0.25) return 'simplified';
  if (zoom >= 0.1) return 'minimal';
  return 'dot';
}

/**
 * Batch node updates for performance.
 */
export function batchNodeUpdates<T>(
  updates: Map<string, T>,
  batchSize: number = 50,
): T[][] {
  const entries = Array.from(updates.values());
  const batches: T[][] = [];
  
  for (let i = 0; i < entries.length; i += batchSize) {
    batches.push(entries.slice(i, i + batchSize));
  }
  
  return batches;
}
```

- [ ] **Step 2: Write tests**

```typescript
// virtualization.test.ts
import { calculateVisibleNodes, calculateLODLevel } from '../virtualization';

describe('calculateVisibleNodes', () => {
  it('should identify visible nodes', () => {
    const nodes = [
      { id: 'n1', x: 100, y: 100, width: 200, height: 100 },
      { id: 'n2', x: 500, y: 100, width: 200, height: 100 },
      { id: 'n3', x: 2000, y: 2000, width: 200, height: 100 },
    ];
    
    const viewport = { x: 0, y: 0, width: 800, height: 600, zoom: 1 };
    const result = calculateVisibleNodes(nodes, viewport);
    
    expect(result.visibleNodes).toContain('n1');
    expect(result.visibleNodes).toContain('n2');
    expect(result.hiddenNodes).toContain('n3');
  });
  
  it('should handle zoom', () => {
    const nodes = [
      { id: 'n1', x: 1000, y: 1000, width: 200, height: 100 },
    ];
    
    // At zoom 0.5, viewport covers more area
    const viewport = { x: 0, y: 0, width: 800, height: 600, zoom: 0.5 };
    const result = calculateVisibleNodes(nodes, viewport);
    
    expect(result.visibleNodes).toContain('n1');
  });
});

describe('calculateLODLevel', () => {
  it('should return full at high zoom', () => {
    expect(calculateLODLevel(1)).toBe('full');
    expect(calculateLODLevel(0.5)).toBe('full');
  });
  
  it('should return simplified at medium zoom', () => {
    expect(calculateLODLevel(0.3)).toBe('simplified');
  });
  
  it('should return minimal at low zoom', () => {
    expect(calculateLODLevel(0.15)).toBe('minimal');
  });
  
  it('should return dot at very low zoom', () => {
    expect(calculateLODLevel(0.05)).toBe('dot');
  });
});
```

- [ ] **Step 3: Tests pass**

- [ ] **Step 4: Commit**

```bash
git add ui/src/graph/virtualization.ts
git commit -m "feat(canvas): add virtualization and LOD calculation"
```

---

## Task 5: LOD Node Renderer

**Files:**
- Create: `ui/src/components/canvas/LODNodeRenderer.tsx`
- Create: `ui/src/graph/lod.ts`

- [ ] **Step 1: Implement LOD node renderer**

```tsx
// LODNodeRenderer.tsx
import React, { useMemo } from 'react';
import { useViewport } from '@xyflow/react';
import { calculateLODLevel, LODLevel } from '../../graph/virtualization';

interface LODNodeRendererProps {
  id: string;
  type: string;
  label: string;
  data: Record<string, unknown>;
  selected: boolean;
  children?: React.ReactNode;
}

/**
 * Renders node with appropriate level of detail based on zoom.
 * 
 * Pattern inspired by ComfyUI's zoom-based rendering.
 */
export function LODNodeRenderer({
  id,
  type,
  label,
  data,
  selected,
  children,
}: LODNodeRendererProps) {
  const { zoom } = useViewport();
  const lodLevel = useMemo(() => calculateLODLevel(zoom), [zoom]);
  
  // Dot level - just a colored circle
  if (lodLevel === 'dot') {
    return (
      <div
        className={`lod-node lod-dot ${selected ? 'selected' : ''}`}
        style={{
          width: 20,
          height: 20,
          borderRadius: '50%',
          backgroundColor: getNodeColor(type),
        }}
      />
    );
  }
  
  // Minimal level - colored box with type indicator
  if (lodLevel === 'minimal') {
    return (
      <div
        className={`lod-node lod-minimal ${selected ? 'selected' : ''}`}
        style={{
          padding: 4,
          backgroundColor: getNodeColor(type),
          borderRadius: 4,
        }}
      >
        <span className="node-type-badge">{type[0].toUpperCase()}</span>
      </div>
    );
  }
  
  // Simplified level - box with label
  if (lodLevel === 'simplified') {
    return (
      <div
        className={`lod-node lod-simplified ${selected ? 'selected' : ''}`}
        style={{
          padding: 8,
          backgroundColor: getNodeColor(type),
          borderRadius: 6,
        }}
      >
        <div className="node-label">{label}</div>
      </div>
    );
  }
  
  // Full level - render children (full node component)
  return (
    <div className={`lod-node lod-full ${selected ? 'selected' : ''}`}>
      {children}
    </div>
  );
}

function getNodeColor(type: string): string {
  const colors: Record<string, string> = {
    start: '#4ade80',
    exit: '#f87171',
    task: '#60a5fa',
    agent: '#a78bfa',
    rag_query: '#fb923c',
    rag_index: '#fbbf24',
    ai_route: '#e879f9',
    trigger_webhook: '#22d3ee',
    trigger_schedule: '#2dd4bf',
    default: '#94a3b8',
  };
  
  return colors[type] || colors.default;
}
```

- [ ] **Step 2: Add LOD utilities**

```typescript
// lod.ts
import { LODLevel } from './virtualization';

export interface LODConfig {
  showHandles: boolean;
  showPorts: boolean;
  showLabels: boolean;
  showContent: boolean;
  interactable: boolean;
}

export function getLODConfig(level: LODLevel): LODConfig {
  switch (level) {
    case 'full':
      return {
        showHandles: true,
        showPorts: true,
        showLabels: true,
        showContent: true,
        interactable: true,
      };
    case 'simplified':
      return {
        showHandles: true,
        showPorts: false,
        showLabels: true,
        showContent: false,
        interactable: true,
      };
    case 'minimal':
      return {
        showHandles: false,
        showPorts: false,
        showLabels: false,
        showContent: false,
        interactable: false,
      };
    case 'dot':
      return {
        showHandles: false,
        showPorts: false,
        showLabels: false,
        showContent: false,
        interactable: false,
      };
  }
}

export function shouldRenderHandle(level: LODLevel): boolean {
  return level === 'full' || level === 'simplified';
}
```

- [ ] **Step 3: Add styles**

```css
/* LOD styles */
.lod-node {
  transition: transform 0.1s ease-out;
}

.lod-node.selected {
  box-shadow: 0 0 0 2px #3b82f6;
}

.lod-dot {
  cursor: pointer;
}

.lod-minimal .node-type-badge {
  font-size: 10px;
  font-weight: bold;
  color: white;
}

.lod-simplified .node-label {
  font-size: 12px;
  color: white;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100px;
}
```

- [ ] **Step 4: Commit**

```bash
git add ui/src/components/canvas/LODNodeRenderer.tsx ui/src/graph/lod.ts
git commit -m "feat(canvas): add LOD node renderer for zoom-based detail"
```

---

## Task 6: Virtualized Canvas Component

**Files:**
- Create: `ui/src/components/canvas/VirtualizedCanvas.tsx`
- Test: `ui/src/__tests__/components/VirtualizedCanvas.test.tsx`

- [ ] **Step 1: Implement virtualized canvas**

```tsx
// VirtualizedCanvas.tsx
import React, { useCallback, useMemo, useState, useEffect } from 'react';
import {
  ReactFlow,
  useNodesState,
  useEdgesState,
  useViewport,
  ReactFlowProvider,
  Node,
  Edge,
} from '@xyflow/react';
import { calculateVisibleNodes, NodeBounds } from '../../graph/virtualization';
import { LODNodeRenderer } from './LODNodeRenderer';

interface VirtualizedCanvasProps {
  initialNodes: Node[];
  initialEdges: Edge[];
  onNodesChange?: (nodes: Node[]) => void;
  onEdgesChange?: (edges: Edge[]) => void;
}

export function VirtualizedCanvas({
  initialNodes,
  initialEdges,
  onNodesChange,
  onEdgesChange,
}: VirtualizedCanvasProps) {
  const [nodes, setNodes, onNodesChangeInternal] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChangeInternal] = useEdgesState(initialEdges);
  const [visibleNodeIds, setVisibleNodeIds] = useState<Set<string>>(new Set());
  
  return (
    <ReactFlowProvider>
      <VirtualizedCanvasInner
        nodes={nodes}
        edges={edges}
        setNodes={setNodes}
        setEdges={setEdges}
        onNodesChangeInternal={onNodesChangeInternal}
        onEdgesChangeInternal={onEdgesChangeInternal}
        visibleNodeIds={visibleNodeIds}
        setVisibleNodeIds={setVisibleNodeIds}
      />
    </ReactFlowProvider>
  );
}

function VirtualizedCanvasInner({
  nodes,
  edges,
  setNodes,
  setEdges,
  onNodesChangeInternal,
  onEdgesChangeInternal,
  visibleNodeIds,
  setVisibleNodeIds,
}: any) {
  const viewport = useViewport();
  
  // Calculate visible nodes on viewport change
  useEffect(() => {
    const nodeBounds: NodeBounds[] = nodes.map((node: Node) => ({
      id: node.id,
      x: node.position.x,
      y: node.position.y,
      width: node.width ?? 200,
      height: node.height ?? 100,
    }));
    
    const viewportBounds = {
      x: -viewport.x / viewport.zoom,
      y: -viewport.y / viewport.zoom,
      width: window.innerWidth,
      height: window.innerHeight,
      zoom: viewport.zoom,
    };
    
    const result = calculateVisibleNodes(nodeBounds, viewportBounds);
    setVisibleNodeIds(new Set([...result.visibleNodes, ...result.nearbyNodes]));
  }, [nodes, viewport, setVisibleNodeIds]);
  
  // Filter nodes for rendering
  const visibleNodes = useMemo(() => {
    return nodes.filter((node: Node) => visibleNodeIds.has(node.id));
  }, [nodes, visibleNodeIds]);
  
  // Filter edges (only show edges between visible nodes)
  const visibleEdges = useMemo(() => {
    return edges.filter((edge: Edge) => 
      visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
    );
  }, [edges, visibleNodeIds]);
  
  // Custom node types with LOD
  const nodeTypes = useMemo(() => ({
    default: (props: any) => (
      <LODNodeRenderer
        id={props.id}
        type={props.type}
        label={props.data?.label ?? props.id}
        data={props.data}
        selected={props.selected}
      >
        {/* Default node content */}
        <div className="default-node">
          <div className="node-header">{props.data?.label ?? props.id}</div>
        </div>
      </LODNodeRenderer>
    ),
  }), []);
  
  return (
    <div className="virtualized-canvas" style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={visibleNodes}
        edges={visibleEdges}
        onNodesChange={onNodesChangeInternal}
        onEdgesChange={onEdgesChangeInternal}
        nodeTypes={nodeTypes}
        minZoom={0.05}
        maxZoom={2}
        fitView
      />
      <div className="virtualization-stats">
        {visibleNodes.length} / {nodes.length} nodes visible
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Tests pass**

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/canvas/VirtualizedCanvas.tsx
git commit -m "feat(canvas): add virtualized canvas with viewport culling"
```

---

## Task 7: Enhanced Minimap

**Files:**
- Create: `ui/src/components/canvas/EnhancedMinimap.tsx`

- [ ] **Step 1: Implement enhanced minimap**

```tsx
// EnhancedMinimap.tsx
import React, { useRef, useEffect, useMemo } from 'react';
import { useNodes, useViewport, useReactFlow } from '@xyflow/react';

interface EnhancedMinimapProps {
  width?: number;
  height?: number;
  nodeColor?: (nodeType: string) => string;
  useWebGL?: boolean;
}

/**
 * Enhanced minimap with WebGL fallback for large graphs.
 * 
 * Pattern: Standard minimap for <500 nodes, WebGL for larger.
 */
export function EnhancedMinimap({
  width = 200,
  height = 150,
  nodeColor = defaultNodeColor,
  useWebGL = true,
}: EnhancedMinimapProps) {
  const nodes = useNodes();
  const viewport = useViewport();
  const { fitView } = useReactFlow();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Calculate bounds
  const bounds = useMemo(() => {
    if (nodes.length === 0) {
      return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    }
    
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    
    for (const node of nodes) {
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + (node.width ?? 200));
      maxY = Math.max(maxY, node.position.y + (node.height ?? 100));
    }
    
    // Add padding
    const padding = 50;
    return {
      minX: minX - padding,
      minY: minY - padding,
      maxX: maxX + padding,
      maxY: maxY + padding,
    };
  }, [nodes]);
  
  // Scale factors
  const scaleX = width / (bounds.maxX - bounds.minX);
  const scaleY = height / (bounds.maxY - bounds.minY);
  const scale = Math.min(scaleX, scaleY);
  
  // Render to canvas (for WebGL or large graphs)
  useEffect(() => {
    if (!useWebGL || nodes.length < 500) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Clear
    ctx.clearRect(0, 0, width, height);
    
    // Draw nodes
    for (const node of nodes) {
      const x = (node.position.x - bounds.minX) * scale;
      const y = (node.position.y - bounds.minY) * scale;
      const w = Math.max(2, (node.width ?? 200) * scale);
      const h = Math.max(2, (node.height ?? 100) * scale);
      
      ctx.fillStyle = nodeColor(node.type ?? 'default');
      ctx.fillRect(x, y, w, h);
    }
    
    // Draw viewport
    const vpX = (-viewport.x / viewport.zoom - bounds.minX) * scale;
    const vpY = (-viewport.y / viewport.zoom - bounds.minY) * scale;
    const vpW = (window.innerWidth / viewport.zoom) * scale;
    const vpH = (window.innerHeight / viewport.zoom) * scale;
    
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.strokeRect(vpX, vpY, vpW, vpH);
    
  }, [nodes, viewport, bounds, scale, width, height, nodeColor, useWebGL]);
  
  // Handle click to pan
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const graphX = x / scale + bounds.minX;
    const graphY = y / scale + bounds.minY;
    
    fitView({
      nodes: [{ id: 'temp', position: { x: graphX, y: graphY }, data: {} }],
      duration: 200,
    });
  };
  
  // Use SVG for small graphs, Canvas for large
  if (!useWebGL || nodes.length < 500) {
    return (
      <div
        className="enhanced-minimap"
        style={{ width, height }}
        onClick={handleClick}
      >
        <svg width={width} height={height}>
          {nodes.map(node => {
            const x = (node.position.x - bounds.minX) * scale;
            const y = (node.position.y - bounds.minY) * scale;
            const w = Math.max(2, (node.width ?? 200) * scale);
            const h = Math.max(2, (node.height ?? 100) * scale);
            
            return (
              <rect
                key={node.id}
                x={x}
                y={y}
                width={w}
                height={h}
                fill={nodeColor(node.type ?? 'default')}
              />
            );
          })}
          
          {/* Viewport indicator */}
          <rect
            x={(-viewport.x / viewport.zoom - bounds.minX) * scale}
            y={(-viewport.y / viewport.zoom - bounds.minY) * scale}
            width={(window.innerWidth / viewport.zoom) * scale}
            height={(window.innerHeight / viewport.zoom) * scale}
            fill="none"
            stroke="#3b82f6"
            strokeWidth={2}
          />
        </svg>
      </div>
    );
  }
  
  return (
    <div
      className="enhanced-minimap"
      style={{ width, height }}
      onClick={handleClick}
    >
      <canvas ref={canvasRef} width={width} height={height} />
    </div>
  );
}

function defaultNodeColor(type: string): string {
  const colors: Record<string, string> = {
    start: '#4ade80',
    exit: '#f87171',
    task: '#60a5fa',
    agent: '#a78bfa',
    default: '#94a3b8',
  };
  return colors[type] || colors.default;
}
```

- [ ] **Step 2: Add styles**

```css
.enhanced-minimap {
  position: absolute;
  bottom: 10px;
  left: 10px;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.enhanced-minimap:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/canvas/EnhancedMinimap.tsx
git commit -m "feat(canvas): add enhanced minimap with WebGL fallback"
```

---

## Task 8: Backend CRDT Sync Route

**Files:**
- Create: `python/graph_caster/run_broker/routes/crdt_sync.py`
- Modify: `python/graph_caster/run_broker/app.py`

- [ ] **Step 1: Implement CRDT sync WebSocket**

```python
# crdt_sync.py
import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Dict, Set
import json

router = APIRouter(prefix="/crdt", tags=["crdt"])

# Room management
_rooms: Dict[str, Set[WebSocket]] = {}
_room_states: Dict[str, bytes] = {}

@router.websocket("/sync/{graph_id}")
async def crdt_sync(websocket: WebSocket, graph_id: str):
    """WebSocket endpoint for Yjs CRDT synchronization.
    
    Implements y-websocket protocol for Yjs document sync.
    """
    await websocket.accept()
    room_name = f"graph:{graph_id}"
    
    # Add to room
    if room_name not in _rooms:
        _rooms[room_name] = set()
    _rooms[room_name].add(websocket)
    
    try:
        # Send existing state if any
        if room_name in _room_states:
            await websocket.send_bytes(_room_states[room_name])
        
        # Handle messages
        while True:
            data = await websocket.receive_bytes()
            
            # Store state update
            _room_states[room_name] = data
            
            # Broadcast to other clients in room
            for client in _rooms[room_name]:
                if client != websocket:
                    try:
                        await client.send_bytes(data)
                    except Exception:
                        pass
                        
    except WebSocketDisconnect:
        pass
    finally:
        # Remove from room
        _rooms[room_name].discard(websocket)
        if not _rooms[room_name]:
            del _rooms[room_name]
```

- [ ] **Step 2: Add to app.py**

```python
from .routes.crdt_sync import router as crdt_router
app.include_router(crdt_router)
```

- [ ] **Step 3: Commit**

```bash
git add python/graph_caster/run_broker/routes/crdt_sync.py
git commit -m "feat(crdt): add WebSocket sync endpoint for Yjs"
```

---

## Task 9: Documentation

**Files:**
- Create: `doc/COLLABORATION.md`

- [ ] **Step 1: Document collaboration features**

```markdown
# GraphCaster Collaboration Guide

## Overview

GraphCaster supports real-time collaborative editing using CRDT (Conflict-free Replicated Data Types) technology. Multiple users can edit the same graph simultaneously.

## Enabling Collaboration

### Server Configuration

Set the CRDT sync endpoint:

```bash
GC_CRDT_ENABLED=true python -m graph_caster serve
```

### Client Configuration

Enable collaboration in the UI:

```typescript
import { useCollaboration } from './crdt/useCollaboration';

function GraphEditor({ graphId }) {
  const collab = useCollaboration(
    'ws://localhost:8000/crdt/sync',
    graphId,
    userId,
    userName
  );
  
  // ...
}
```

## Features

### Real-time Cursors

See other users' cursors in real-time as they navigate the canvas.

### Selection Awareness

See what nodes other users have selected.

### Conflict Resolution

CRDT automatically resolves conflicts when multiple users edit the same node.

## Performance

### Virtualization

For large graphs (500+ nodes), virtualization is automatically enabled:

- Only visible nodes are rendered
- Nearby nodes are pre-loaded
- Hidden nodes are culled

### Level of Detail

At different zoom levels, nodes render with appropriate detail:

- **Full** (zoom >= 0.5): All details visible
- **Simplified** (zoom >= 0.25): Labels only
- **Minimal** (zoom >= 0.1): Type indicator
- **Dot** (zoom < 0.1): Colored dot

### WebGL Minimap

For graphs with 500+ nodes, the minimap uses WebGL rendering for better performance.
```

- [ ] **Step 2: Commit**

```bash
git add doc/COLLABORATION.md
git commit -m "docs: add collaboration and UX features guide"
```

---

## Success Criteria

- [ ] Yjs document sync works between clients
- [ ] Remote cursors display correctly
- [ ] Virtualization culls off-viewport nodes
- [ ] LOD renders appropriately at zoom levels
- [ ] Minimap handles large graphs
- [ ] CRDT WebSocket endpoint stable
- [ ] Documentation complete

---

## Dependencies

Add to `package.json`:

```json
{
  "dependencies": {
    "yjs": "^13.6",
    "y-websocket": "^1.5",
    "y-protocols": "^1.0"
  }
}
```
