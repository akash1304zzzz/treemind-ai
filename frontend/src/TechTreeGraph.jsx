import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Play, FileText, ChevronRight, Maximize2, Minus, Plus, RefreshCw } from 'lucide-react';

export default function TechTreeGraph({ notes, onSelectNote }) {
  const [collapsed, setCollapsed] = useState(new Set()); // set of collapsed category paths
  const [pan, setPan] = useState({ x: 50, y: 150 });
  const [zoom, setZoom] = useState(0.85);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const containerRef = useRef(null);

  // Toggle category collapse
  const toggleCollapse = (pathStr) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(pathStr)) {
        next.delete(pathStr);
      } else {
        next.add(pathStr);
      }
      return next;
    });
  };

  // Zoom helpers
  const handleZoomIn = () => setZoom(z => Math.min(z + 0.1, 1.8));
  const handleZoomOut = () => setZoom(z => Math.max(z - 0.1, 0.4));
  const handleZoomReset = () => {
    setZoom(0.85);
    setPan({ x: 50, y: 150 });
  };

  // Mouse pan handlers
  const handleMouseDown = (e) => {
    // Only pan on left click or middle click
    if (e.button !== 0 && e.button !== 1) return;
    isDragging.current = true;
    dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  const handleMouseMove = (e) => {
    if (!isDragging.current) return;
    setPan({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y
    });
  };

  const handleMouseUp = () => {
    isDragging.current = false;
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const zoomFactor = 0.05;
    if (e.deltaY < 0) {
      setZoom(z => Math.min(z + zoomFactor, 1.8));
    } else {
      setZoom(z => Math.max(z - zoomFactor, 0.4));
    }
  };

  // Parse notes into hierarchical layout nodes
  const graphData = useMemo(() => {
    // 1. Build hierarchy
    const tree = { id: 'root', label: 'Vault', type: 'root', children: {} };

    notes.forEach(note => {
      const path = note.categoryPath || ['General'];
      const rootCat = path[0] || 'General';
      const subCat = path[1] || null;

      if (!tree.children[rootCat]) {
        tree.children[rootCat] = {
          id: `cat:${rootCat}`,
          label: rootCat,
          type: 'category',
          pathStr: rootCat,
          children: {}
        };
      }

      if (subCat) {
        const fullSubPath = `${rootCat}/${subCat}`;
        if (!tree.children[rootCat].children[subCat]) {
          tree.children[rootCat].children[subCat] = {
            id: `sub:${fullSubPath}`,
            label: subCat,
            type: 'subcategory',
            pathStr: fullSubPath,
            notes: []
          };
        }
        tree.children[rootCat].children[subCat].notes.push(note);
      } else {
        // Note belongs directly to main category
        if (!tree.children[rootCat].children['__direct__']) {
          tree.children[rootCat].children['__direct__'] = {
            id: `sub:${rootCat}/__direct__`,
            label: 'General',
            type: 'subcategory',
            pathStr: `${rootCat}/__direct__`,
            notes: [],
            isDirect: true
          };
        }
        tree.children[rootCat].children['__direct__'].notes.push(note);
      }
    });

    // 2. Flatten nodes & calculate tree layout coordinates
    const nodes = [];
    const links = [];
    let leafCount = 0;

    const rootNode = {
      id: 'root',
      label: 'TreeMind Vault',
      type: 'root',
      x: 30,
      y: 0,
      width: 160,
      height: 46
    };
    nodes.push(rootNode);

    // Main Categories
    Object.values(tree.children).forEach(cat => {
      const catNode = {
        id: cat.id,
        label: cat.label,
        type: 'category',
        pathStr: cat.pathStr,
        x: 230,
        y: 0,
        width: 160,
        height: 40
      };
      nodes.push(catNode);
      links.push({ source: 'root', target: cat.id });

      const isCatCollapsed = collapsed.has(cat.pathStr);

      if (isCatCollapsed) {
        // Collapsed category acts as a leaf node
        catNode.y = leafCount * 90;
        leafCount++;
        return;
      }

      const activeSubCats = Object.values(cat.children).filter(sub => {
        return sub.notes && sub.notes.length > 0;
      });

      let subCatYSum = 0;
      let visibleSubCatCount = 0;

      activeSubCats.forEach(sub => {
        const isSubCollapsed = collapsed.has(sub.pathStr);
        const subNode = {
          id: sub.id,
          label: sub.label,
          type: 'subcategory',
          pathStr: sub.pathStr,
          x: 460,
          y: 0,
          width: 160,
          height: 40,
          isDirect: sub.isDirect
        };
        
        // Only push subcategory node if it isn't a direct filler
        if (!sub.isDirect) {
          nodes.push(subNode);
          links.push({ source: cat.id, target: sub.id });
        }

        if (isSubCollapsed) {
          subNode.y = leafCount * 90;
          leafCount++;
          subCatYSum += subNode.y;
          visibleSubCatCount++;
          return;
        }

        // Notes inside subcategory
        let noteYSum = 0;
        sub.notes.forEach(note => {
          const noteNode = {
            id: `note:${note.id}`,
            label: note.title,
            type: 'note',
            note: note,
            x: 690,
            y: leafCount * 90,
            width: 220,
            height: 65
          };
          nodes.push(noteNode);
          links.push({ 
            source: sub.isDirect ? cat.id : sub.id, 
            target: noteNode.id 
          });
          noteYSum += noteNode.y;
          leafCount++;
        });

        if (sub.notes.length > 0) {
          const avgY = noteYSum / sub.notes.length;
          if (!sub.isDirect) {
            subNode.y = avgY;
            subCatYSum += subNode.y;
            visibleSubCatCount++;
          } else {
            subCatYSum += avgY;
            visibleSubCatCount++;
          }
        }
      });

      if (visibleSubCatCount > 0) {
        catNode.y = subCatYSum / visibleSubCatCount;
      } else {
        catNode.y = leafCount * 90;
        leafCount++;
      }
    });

    // Center root Y coordinate relative to all main categories
    const categories = nodes.filter(n => n.type === 'category');
    if (categories.length > 0) {
      rootNode.y = categories.reduce((sum, n) => sum + n.y, 0) / categories.length;
    } else {
      rootNode.y = 0;
    }

    return { nodes, links, leafCount };
  }, [notes, collapsed]);

  // Generate smooth cubic bezier paths
  const getBezierPath = (source, target) => {
    const s = graphData.nodes.find(n => n.id === source);
    const t = graphData.nodes.find(n => n.id === target);
    if (!s || !t) return '';

    const startX = s.x + s.width;
    const startY = s.y + s.height / 2;
    const endX = t.x;
    const endY = t.y + t.height / 2;

    const controlX = (startX + endX) / 2;

    return `M ${startX} ${startY} C ${controlX} ${startY}, ${controlX} ${endY}, ${endX} ${endY}`;
  };

  return (
    <div 
      ref={containerRef}
      className="tech-tree-container"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      style={{
        width: '100%',
        height: 'calc(100vh - 220px)',
        position: 'relative',
        overflow: 'hidden',
        cursor: isDragging.current ? 'grabbing' : 'grab',
        background: '#090812',
        borderRadius: '12px',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        userSelect: 'none'
      }}
    >
      {/* Zoom / Pan Controls Overlay */}
      <div 
        style={{
          position: 'absolute',
          top: '16px',
          right: '16px',
          display: 'flex',
          gap: '8px',
          zIndex: 10
        }}
      >
        <button className="control-btn" onClick={handleZoomIn} title="Zoom In">
          <Plus size={16} />
        </button>
        <button className="control-btn" onClick={handleZoomOut} title="Zoom Out">
          <Minus size={16} />
        </button>
        <button className="control-btn" onClick={handleZoomReset} title="Reset View">
          <Maximize2 size={16} />
        </button>
      </div>

      <div style={{ position: 'absolute', bottom: '12px', left: '16px', zIndex: 10, fontSize: 11, color: 'var(--text-secondary)' }}>
        🖱️ Click & Drag to Pan | 📜 Scroll to Zoom
      </div>

      {/* SVG Canvas Workspace */}
      <svg
        width="100%"
        height="100%"
        style={{ pointerEvents: 'none' }}
      >
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`} style={{ pointerEvents: 'auto' }}>
          {/* Connection Lines */}
          <g>
            {graphData.links.map((link, idx) => (
              <path
                key={`link-${idx}`}
                d={getBezierPath(link.source, link.target)}
                fill="none"
                stroke="rgba(139, 92, 246, 0.25)"
                strokeWidth={2}
                style={{
                  transition: 'd 0.3s ease'
                }}
              />
            ))}
          </g>

          {/* Node Renderers */}
          {graphData.nodes.map(node => {
            const isCollapsed = collapsed.has(node.pathStr);

            return (
              <foreignObject
                key={node.id}
                x={node.x}
                y={node.y}
                width={node.width}
                height={node.height}
                style={{
                  overflow: 'visible',
                  transition: 'y 0.3s ease'
                }}
              >
                {node.type === 'root' && (
                  <div className="tree-node-root">
                    <div style={{ fontWeight: 600, fontSize: 13, color: '#c084fc' }}>{node.label}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>Knowledge Tree</div>
                  </div>
                )}

                {node.type === 'category' && (
                  <div 
                    className={`tree-node-category ${isCollapsed ? 'collapsed' : ''}`}
                    onClick={() => toggleCollapse(node.pathStr)}
                  >
                    <span style={{ fontWeight: 600, fontSize: 13, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {node.label}
                    </span>
                    <ChevronRight 
                      size={14} 
                      style={{ 
                        marginLeft: 'auto',
                        transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                        transition: 'transform 0.2s ease',
                        flexShrink: 0
                      }} 
                    />
                  </div>
                )}

                {node.type === 'subcategory' && (
                  <div 
                    className={`tree-node-subcategory ${isCollapsed ? 'collapsed' : ''}`}
                    onClick={() => toggleCollapse(node.pathStr)}
                  >
                    <span style={{ fontWeight: 500, fontSize: 12, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {node.label}
                    </span>
                    <ChevronRight 
                      size={13} 
                      style={{ 
                        marginLeft: 'auto',
                        transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                        transition: 'transform 0.2s ease',
                        flexShrink: 0
                      }} 
                    />
                  </div>
                )}

                {node.type === 'note' && (
                  <div 
                    className="tree-node-note"
                    onClick={() => onSelectNote(node.note)}
                  >
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <FileText size={14} color="#a855f7" style={{ flexShrink: 0 }} />
                      <div className="node-note-title">{node.label}</div>
                    </div>
                    {node.note.snippet && (
                      <div className="node-note-snippet">{node.note.snippet}</div>
                    )}
                  </div>
                )}
              </foreignObject>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
