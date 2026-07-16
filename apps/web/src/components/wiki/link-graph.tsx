"use client";

import { Alert, AlertDescription, AlertTitle } from "@kherad/ui/components/ui/alert";
import { Badge } from "@kherad/ui/components/ui/badge";
import { Button } from "@kherad/ui/components/ui/button";
import { Input } from "@kherad/ui/components/ui/input";
import { Maximize2Icon, SearchIcon, XIcon, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchBundleGraph, type BundleGraph } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";

const MIN_HEIGHT = 480;
const PADDING = 72;
const LABEL_WIDTH = 150;

/* Entrance/selection motion. Node labels are HTML inside <foreignObject> so Persian/RTL
   titles shape and truncate correctly — SVG <text> with estimated glyph widths does not. */
const GRAPH_CSS = `
@keyframes lg-node-in { from { opacity: 0; transform: scale(0.4); } }
@keyframes lg-edge-in { from { opacity: 0; } }
@keyframes lg-ping {
  0% { opacity: 0.55; transform: scale(1); }
  100% { opacity: 0; transform: scale(2.1); }
}
.lg-node {
  transform-box: fill-box;
  transform-origin: center;
  animation: lg-node-in 480ms var(--ease-out-spring) backwards;
}
.lg-edge { animation: lg-edge-in 400ms ease-out backwards; }
.lg-ping {
  transform-box: fill-box;
  transform-origin: center;
  animation: lg-ping 650ms ease-out forwards;
}
@media (prefers-reduced-motion: reduce) {
  .lg-node, .lg-edge { animation: none !important; }
  .lg-ping { display: none; }
  .lg-scene { transition: none !important; }
}
`;

type Positioned = { id: string; title: string; path: string; x: number; y: number; degree: number };
type Viewport = { x: number; y: number; scale: number };

function nodeRadius(degree: number): number {
  return 5 + Math.min(degree, 8) * 0.75;
}

/**
 * Small deterministic force-directed layout (Fruchterman–Reingold style):
 * pairwise repulsion + spring attraction along edges, cooling over a fixed
 * number of iterations. Plenty for wiki-sized graphs; avoids a d3 dependency.
 */
function layoutGraph(graph: BundleGraph, width: number, height: number): Positioned[] {
  const n = graph.nodes.length;
  if (n === 0) return [];

  const area = width * height;
  // Labels are always visible now, so spread nodes a bit further apart.
  const k = Math.sqrt(area / n) * 0.82;
  const positions = graph.nodes.map((node, i) => {
    const angle = (2 * Math.PI * i) / n;
    const radius = Math.min(width, height) / 3 + (i % 3) * 16;
    return {
      id: node.id,
      x: width / 2 + radius * Math.cos(angle),
      y: height / 2 + radius * Math.sin(angle),
      dx: 0,
      dy: 0,
    };
  });
  const indexById = new Map(positions.map((p, i) => [p.id, i]));

  let temperature = Math.min(width, height) / 8;
  const iterations = 280;
  for (let iter = 0; iter < iterations; iter++) {
    for (const p of positions) {
      p.dx = 0;
      p.dy = 0;
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = positions[i]!;
        const b = positions[j]!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.01) {
          dx = (i - j) * 0.1;
          dy = 0.1;
          dist = Math.sqrt(dx * dx + dy * dy);
        }
        const force = (k * k) / dist;
        a.dx += (dx / dist) * force;
        a.dy += (dy / dist) * force;
        b.dx -= (dx / dist) * force;
        b.dy -= (dy / dist) * force;
      }
    }
    for (const edge of graph.edges) {
      const ai = indexById.get(edge.from);
      const bi = indexById.get(edge.to);
      if (ai === undefined || bi === undefined) continue;
      const a = positions[ai]!;
      const b = positions[bi]!;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
      const force = (dist * dist) / k;
      a.dx -= (dx / dist) * force;
      a.dy -= (dy / dist) * force;
      b.dx += (dx / dist) * force;
      b.dy += (dy / dist) * force;
    }
    for (const p of positions) {
      const disp = Math.max(Math.sqrt(p.dx * p.dx + p.dy * p.dy), 0.01);
      const step = Math.min(disp, temperature);
      p.x += (p.dx / disp) * step;
      p.y += (p.dy / disp) * step;
      p.x = Math.min(width - PADDING, Math.max(PADDING, p.x));
      p.y = Math.min(height - PADDING, Math.max(PADDING, p.y));
    }
    temperature *= 0.97;
  }

  const degree = new Map<string, number>();
  for (const edge of graph.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }

  return graph.nodes.map((node, i) => ({
    ...node,
    x: positions[i]!.x,
    y: positions[i]!.y,
    degree: degree.get(node.id) ?? 0,
  }));
}

function computeFitView(nodes: Positioned[], width: number, height: number): Viewport {
  if (nodes.length === 0) return { x: 0, y: 0, scale: 1 };

  const radii = nodes.map((node) => nodeRadius(node.degree) + 28);
  const xs = nodes.map((node, i) => node.x - radii[i]!);
  const ys = nodes.map((node, i) => node.y - radii[i]!);
  const xe = nodes.map((node, i) => node.x + radii[i]!);
  const ye = nodes.map((node, i) => node.y + radii[i]!);

  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xe);
  const maxY = Math.max(...ye);
  const contentW = maxX - minX;
  const contentH = maxY - minY;

  const scale = Math.min((width - 48) / contentW, (height - 48) / contentH, 1.4);
  const x = (width - contentW * scale) / 2 - minX * scale;
  const y = (height - contentH * scale) / 2 - minY * scale;

  return { x, y, scale };
}

/**
 * Breadth-first traversal order starting from the highest-degree node, so the
 * entrance animation reads as the graph "growing" outward hub-first rather
 * than nodes popping in in arbitrary fetch order.
 */
function computeRevealOrder(graph: BundleGraph): Map<string, number> {
  const adjacency = new Map<string, string[]>();
  const degree = new Map<string, number>();
  for (const node of graph.nodes) {
    adjacency.set(node.id, []);
    degree.set(node.id, 0);
  }
  for (const edge of graph.edges) {
    if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) continue;
    adjacency.get(edge.from)!.push(edge.to);
    adjacency.get(edge.to)!.push(edge.from);
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }

  const order = new Map<string, number>();
  const remaining = [...graph.nodes].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0));

  for (const seed of remaining) {
    if (order.has(seed.id)) continue;
    const queue = [seed.id];
    order.set(seed.id, order.size);
    while (queue.length > 0) {
      const current = queue.shift()!;
      const neighbors = [...(adjacency.get(current) ?? [])].sort(
        (a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0),
      );
      for (const neighbor of neighbors) {
        if (order.has(neighbor)) continue;
        order.set(neighbor, order.size);
        queue.push(neighbor);
      }
    }
  }

  return order;
}

function edgeEndpoints(
  from: Positioned,
  to: Positioned,
  fromR: number,
  toR: number,
): { x1: number; y1: number; x2: number; y2: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
  const ux = dx / dist;
  const uy = dy / dist;
  return {
    x1: from.x + ux * fromR,
    y1: from.y + uy * fromR,
    x2: to.x - ux * toR,
    y2: to.y - uy * toR,
  };
}

function curvedEdgePath(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
  const bend = Math.min(len * 0.18, 36);
  const cx = mx + (-dy / len) * bend;
  const cy = my + (dx / len) * bend;
  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
}

type LinkGraphProps = {
  bundleId: string;
  bundleSlug: string;
  bundleTitle: string;
};

export function LinkGraph({ bundleId, bundleSlug, bundleTitle }: LinkGraphProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const panRef = useRef({ active: false, moved: false, lastX: 0, lastY: 0 });
  const dragRef = useRef<{ id: string; moved: boolean; lastX: number; lastY: number } | null>(
    null,
  );

  const [graph, setGraph] = useState<BundleGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 900, height: MIN_HEIGHT });
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const [fitView, setFitView] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [query, setQuery] = useState("");
  // True while the viewport moves programmatically (reset/focus) so the scene
  // glides there; direct manipulation (pan/zoom) stays 1:1 with no transition.
  const [glide, setGlide] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const graphData = await fetchBundleGraph(bundleId);
        if (!cancelled) {
          setGraph(graphData);
          setOverrides(new Map());
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t.graph.loadFailed);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bundleId, t.graph.loadFailed]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(([entry]) => {
      const { width } = entry!.contentRect;
      const height = Math.max(MIN_HEIGHT, Math.round(width * 0.62));
      setSize({ width: Math.max(width, 320), height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const baseNodes = useMemo(
    () => (graph ? layoutGraph(graph, size.width, size.height) : []),
    [graph, size.width, size.height],
  );
  const nodes = useMemo(
    () =>
      baseNodes.map((node) => {
        const override = overrides.get(node.id);
        return override ? { ...node, x: override.x, y: override.y } : node;
      }),
    [baseNodes, overrides],
  );
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const revealOrder = useMemo(
    () => (graph ? computeRevealOrder(graph) : new Map<string, number>()),
    [graph],
  );

  useEffect(() => {
    if (baseNodes.length === 0) return;
    const next = computeFitView(baseNodes, size.width, size.height);
    setFitView(next);
    setView(next);
  }, [baseNodes, size.width, size.height]);

  const normalizedQuery = query.trim().toLowerCase();
  const searchMatches = useMemo(() => {
    if (!normalizedQuery) return null;
    const set = new Set<string>();
    for (const node of nodes) {
      if (
        node.title.toLowerCase().includes(normalizedQuery) ||
        node.path.toLowerCase().includes(normalizedQuery)
      ) {
        set.add(node.id);
      }
    }
    return set;
  }, [nodes, normalizedQuery]);

  const focusId = hovered ?? selected;

  const connectedToFocus = useMemo(() => {
    if (!focusId || !graph) return null;
    const set = new Set<string>([focusId]);
    for (const edge of graph.edges) {
      if (edge.from === focusId) set.add(edge.to);
      if (edge.to === focusId) set.add(edge.from);
    }
    return set;
  }, [focusId, graph]);

  const selectedNode = selected ? nodeById.get(selected) : null;
  const selectedNeighbors = useMemo(() => {
    if (!selected || !graph) return { inbound: [] as Positioned[], outbound: [] as Positioned[] };
    const inbound: Positioned[] = [];
    const outbound: Positioned[] = [];
    for (const edge of graph.edges) {
      if (edge.to === selected) {
        const node = nodeById.get(edge.from);
        if (node) inbound.push(node);
      }
      if (edge.from === selected) {
        const node = nodeById.get(edge.to);
        if (node) outbound.push(node);
      }
    }
    return { inbound, outbound };
  }, [selected, graph, nodeById]);

  const resetView = useCallback(() => {
    setGlide(true);
    setView(fitView);
  }, [fitView]);

  const handleWheel = useCallback((event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    setGlide(false);
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const delta = event.deltaY > 0 ? 0.92 : 1.08;

    setView((current) => {
      const nextScale = Math.min(2.5, Math.max(0.35, current.scale * delta));
      const scaleRatio = nextScale / current.scale;
      return {
        scale: nextScale,
        x: pointerX - (pointerX - current.x) * scaleRatio,
        y: pointerY - (pointerY - current.y) * scaleRatio,
      };
    });
  }, []);

  const handleBackgroundPointerDown = useCallback((event: React.PointerEvent<SVGRectElement>) => {
    if (event.button !== 0) return;
    setGlide(false);
    panRef.current = {
      active: true,
      moved: false,
      lastX: event.clientX,
      lastY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handleBackgroundPointerMove = useCallback((event: React.PointerEvent<SVGRectElement>) => {
    if (!panRef.current.active) return;
    const dx = event.clientX - panRef.current.lastX;
    const dy = event.clientY - panRef.current.lastY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) panRef.current.moved = true;
    panRef.current.lastX = event.clientX;
    panRef.current.lastY = event.clientY;
    setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
  }, []);

  const handleBackgroundPointerUp = useCallback((event: React.PointerEvent<SVGRectElement>) => {
    panRef.current.active = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (!panRef.current.moved) setSelected(null);
  }, []);

  const handleNodePointerDown = useCallback(
    (event: React.PointerEvent<SVGGElement>, nodeId: string) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      setGlide(false);
      dragRef.current = { id: nodeId, moved: false, lastX: event.clientX, lastY: event.clientY };
      setDraggingId(nodeId);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [],
  );

  const handleNodePointerMove = useCallback((event: React.PointerEvent<SVGGElement>) => {
    const drag = dragRef.current;
    const svg = svgRef.current;
    if (!drag || !svg) return;

    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) drag.moved = true;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;

    const rect = svg.getBoundingClientRect();
    const factor = size.width / rect.width / view.scale;
    setOverrides((prev) => {
      const next = new Map(prev);
      const base = prev.get(drag.id) ?? nodeById.get(drag.id);
      if (!base) return prev;
      next.set(drag.id, { x: base.x + dx * factor, y: base.y + dy * factor });
      return next;
    });
  }, [size.width, view.scale, nodeById]);

  const handleNodePointerUp = useCallback(
    (event: React.PointerEvent<SVGGElement>, nodeId: string) => {
      const drag = dragRef.current;
      if (!drag || drag.id !== nodeId) return;
      event.currentTarget.releasePointerCapture(event.pointerId);
      dragRef.current = null;
      setDraggingId(null);
      if (!drag.moved) setSelected(nodeId);
    },
    [],
  );

  const focusNode = useCallback(
    (nodeId: string) => {
      const node = nodeById.get(nodeId);
      if (!node) return;
      setSelected(nodeId);
      setGlide(true);
      setView((current) => ({
        scale: Math.max(current.scale, 1),
        x: size.width / 2 - node.x * Math.max(current.scale, 1),
        y: size.height / 2 - node.y * Math.max(current.scale, 1),
      }));
    },
    [nodeById, size.width, size.height],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelected(null);
        setHovered(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t.graph.loadTitle}</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!graph) {
    return (
      <div className="surface-card flex min-h-[480px] animate-pulse flex-col gap-4 rounded-xl p-6">
        <div className="bg-muted h-8 w-64 rounded-lg" />
        <div className="bg-muted/70 flex-1 rounded-lg" />
      </div>
    );
  }

  const hasSearch = searchMatches !== null;
  const searchEmpty = hasSearch && searchMatches.size === 0;
  // Grow-the-graph reveal pacing: bigger graphs get a shorter per-node step so the
  // whole thing still finishes revealing in roughly a second.
  const revealStep =
    graph.nodes.length > 0 ? Math.min(55, Math.max(14, 600 / graph.nodes.length)) : 0;
  const nodeRevealDelay = (id: string, fallbackIndex: number) =>
    Math.min((revealOrder.get(id) ?? fallbackIndex) * revealStep, 900);

  return (
    <div className="flex flex-col gap-4">
      {nodes.length === 0 ? (
        <div className="surface-card flex min-h-[280px] flex-col items-center justify-center gap-2 rounded-xl px-6 py-12 text-center">
          <p className="text-foreground text-sm font-medium">{t.graph.noPagesTitle}</p>
          <p className="text-muted-foreground max-w-sm text-sm">{t.graph.noPagesBody}</p>
        </div>
      ) : (
        <div
          ref={containerRef}
          className="surface-card relative overflow-hidden rounded-xl"
          style={{ minHeight: MIN_HEIGHT }}
        >
          <div
            className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 border-b border-transparent bg-gradient-to-b from-[color-mix(in_oklch,var(--card)_92%,transparent)] to-transparent px-3 py-2.5 sm:px-4"
            data-materialize
          >
            <div className="pointer-events-auto relative min-w-0 flex-1 sm:max-w-xs">
              <SearchIcon className="text-muted-foreground pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t.graph.findPage}
                className="bg-background/80 h-8 ps-8 text-sm backdrop-blur-sm"
                aria-label={t.graph.searchAria}
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="text-muted-foreground hover:text-foreground absolute end-2 top-1/2 -translate-y-1/2 rounded p-0.5 transition-colors duration-150"
                  aria-label={t.graph.clearSearch}
                >
                  <XIcon className="size-3.5" />
                </button>
              ) : null}
            </div>

            <div className="pointer-events-auto flex shrink-0 items-center gap-2">
              <Badge
                variant="outline"
                className="bg-background/80 hidden backdrop-blur-sm sm:inline-flex"
              >
                {graph.nodes.length} {graph.nodes.length === 1 ? t.graph.page : t.graph.pages}
              </Badge>
              <Badge variant="outline" className="bg-background/80 backdrop-blur-sm">
                {graph.edges.length} {graph.edges.length === 1 ? t.graph.link : t.graph.links}
              </Badge>
              <Button
                type="button"
                variant="outline"
                size="icon-xs"
                onClick={resetView}
                aria-label={t.graph.resetView}
                className="bg-background/80 backdrop-blur-sm"
              >
                <Maximize2Icon />
              </Button>
            </div>
          </div>

          <svg
            ref={svgRef}
            viewBox={`0 0 ${size.width} ${size.height}`}
            className="h-auto w-full touch-none select-none"
            role="img"
            aria-label={t.graph.ariaLabel(bundleTitle)}
            onWheel={handleWheel}
          >
            <style>{GRAPH_CSS}</style>
            <defs>
              <pattern id="graph-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="0.75" fill="var(--border)" opacity="0.55" />
              </pattern>
              <radialGradient id="node-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.35" />
                <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
              </radialGradient>
              <filter id="node-shadow" x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodOpacity="0.12" />
              </filter>
            </defs>

            <rect
              width={size.width}
              height={size.height}
              fill="transparent"
              className="cursor-grab active:cursor-grabbing"
              onPointerDown={handleBackgroundPointerDown}
              onPointerMove={handleBackgroundPointerMove}
              onPointerUp={handleBackgroundPointerUp}
              onPointerCancel={handleBackgroundPointerUp}
            />

            <g
              className="lg-scene"
              style={{
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                transition: glide ? "transform 550ms var(--ease-out-spring)" : "none",
              }}
            >
              <rect
                x={-6000}
                y={-6000}
                width={12000}
                height={12000}
                fill="url(#graph-grid)"
                opacity="0.4"
                pointerEvents="none"
              />

              {graph.edges.map((edge, i) => {
                const from = nodeById.get(edge.from);
                const to = nodeById.get(edge.to);
                if (!from || !to) return null;

                const fromR = nodeRadius(from.degree);
                const toR = nodeRadius(to.degree);
                const { x1, y1, x2, y2 } = edgeEndpoints(from, to, fromR, toR);

                const isFocusedEdge =
                  focusId !== null && (edge.from === focusId || edge.to === focusId);
                const matchesSearch =
                  hasSearch && searchMatches.has(edge.from) && searchMatches.has(edge.to);
                const dimmed =
                  (connectedToFocus !== null && !isFocusedEdge) ||
                  (hasSearch && !matchesSearch && !isFocusedEdge);

                const outbound = focusId === edge.from;
                const inbound = focusId === edge.to;
                const edgeDelay =
                  80 + Math.max(nodeRevealDelay(edge.from, 0), nodeRevealDelay(edge.to, 0));

                return (
                  <path
                    key={i}
                    d={curvedEdgePath(x1, y1, x2, y2)}
                    fill="none"
                    stroke={
                      isFocusedEdge
                        ? outbound
                          ? "var(--primary)"
                          : inbound
                            ? "color-mix(in oklch, var(--primary), var(--muted-foreground) 35%)"
                            : "var(--primary)"
                        : "var(--border)"
                    }
                    strokeWidth={isFocusedEdge ? 1.75 : 1}
                    strokeOpacity={dimmed ? 0.14 : isFocusedEdge ? 0.85 : 0.55}
                    strokeLinecap="round"
                    className="lg-edge ease-out-spring transition-[stroke-opacity,stroke] duration-200"
                    style={{ animationDelay: `${edgeDelay}ms` }}
                  />
                );
              })}

              {nodes.map((node, i) => {
                const radius = nodeRadius(node.degree);
                const isHovered = hovered === node.id;
                const isSelected = selected === node.id;
                const isSearchMatch = hasSearch && searchMatches.has(node.id);
                const isConnected = connectedToFocus?.has(node.id) ?? false;
                const dimmed =
                  (connectedToFocus !== null && !isConnected) ||
                  (hasSearch && !isSearchMatch && !isConnected);

                const isDragging = draggingId === node.id;

                return (
                  <g
                    key={node.id}
                    opacity={dimmed ? 0.22 : 1}
                    className={`lg-node ease-out-spring transition-opacity duration-200 ${
                      isDragging ? "cursor-grabbing" : "cursor-grab"
                    }`}
                    style={{ animationDelay: `${nodeRevealDelay(node.id, i)}ms` }}
                    onPointerEnter={() => setHovered(node.id)}
                    onPointerLeave={() => setHovered(null)}
                    onPointerDown={(event) => handleNodePointerDown(event, node.id)}
                    onPointerMove={handleNodePointerMove}
                    onPointerUp={(event) => handleNodePointerUp(event, node.id)}
                    onPointerCancel={(event) => handleNodePointerUp(event, node.id)}
                    onDoubleClick={() => {
                      window.location.href = `/sources/${bundleSlug}/${node.path}`;
                    }}
                  >
                    {(isHovered || isSelected) && (
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={radius + 10}
                        fill="url(#node-glow)"
                        pointerEvents="none"
                      />
                    )}

                    {isSelected && (
                      <circle
                        key={`ping-${node.id}`}
                        cx={node.x}
                        cy={node.y}
                        r={radius + 5}
                        fill="none"
                        stroke="var(--primary)"
                        strokeWidth={1.5}
                        pointerEvents="none"
                        className="lg-ping"
                      />
                    )}

                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={radius + (isSelected ? 2.5 : isHovered ? 1.5 : 0)}
                      fill="var(--card)"
                      stroke={
                        isSelected
                          ? "var(--primary)"
                          : isSearchMatch
                            ? "color-mix(in oklch, var(--primary), var(--foreground) 20%)"
                            : "color-mix(in oklch, var(--border), var(--primary) 25%)"
                      }
                      strokeWidth={isSelected ? 2 : 1.25}
                      filter="url(#node-shadow)"
                      className="ease-out-spring transition-[r] duration-150"
                    />
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={Math.max(2.5, radius - 1.5)}
                      fill={
                        isSelected
                          ? "var(--primary)"
                          : isSearchMatch
                            ? "color-mix(in oklch, var(--primary), var(--foreground) 15%)"
                            : "color-mix(in oklch, var(--primary), transparent 30%)"
                      }
                      pointerEvents="none"
                      className="ease-out-spring transition-[fill] duration-150"
                    />

                    <foreignObject
                      x={node.x - LABEL_WIDTH / 2}
                      y={node.y + radius + 3}
                      width={LABEL_WIDTH}
                      height={26}
                      pointerEvents="none"
                      className="overflow-visible"
                    >
                      <div className="flex justify-center">
                        <span
                          dir="auto"
                          className={`max-w-full truncate rounded-full px-1.5 text-[10px] leading-4 transition-colors duration-150 ${
                            isSelected
                              ? "bg-primary text-primary-foreground font-medium"
                              : isHovered || isSearchMatch
                                ? "text-foreground bg-[color-mix(in_oklch,var(--card)_92%,transparent)] font-medium"
                                : "text-muted-foreground bg-[color-mix(in_oklch,var(--card)_72%,transparent)]"
                          }`}
                        >
                          {node.title}
                        </span>
                      </div>
                    </foreignObject>
                  </g>
                );
              })}
            </g>
          </svg>

          {searchEmpty ? (
            <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center px-6">
              <p className="text-muted-foreground animate-in fade-in rounded-full border border-dashed bg-[color-mix(in_oklch,var(--card)_90%,transparent)] px-4 py-2 text-sm backdrop-blur-sm duration-300">
                {t.graph.noMatch(query)}
              </p>
            </div>
          ) : null}

          {selectedNode ? (
            <div
              className="animate-in fade-in motion-safe:slide-in-from-bottom-2 ease-out-spring absolute bottom-3 start-3 z-10 w-[min(100%-1.5rem,20rem)] rounded-xl border border-[color-mix(in_oklch,var(--border),var(--primary)_18%)] bg-[color-mix(in_oklch,var(--card)_94%,transparent)] p-3 shadow-sm backdrop-blur-md duration-300"
              data-materialize
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p dir="auto" className="truncate text-sm font-medium">
                    {selectedNode.title}
                  </p>
                  <p className="text-muted-foreground truncate font-mono text-xs" dir="ltr">
                    {selectedNode.path}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="text-muted-foreground hover:text-foreground shrink-0 rounded p-1 transition-colors duration-150"
                  aria-label={t.graph.closeDetails}
                >
                  <XIcon className="size-3.5" />
                </button>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge variant="secondary">{t.graph.connections(selectedNode.degree)}</Badge>
                {selectedNeighbors.inbound.length > 0 ? (
                  <Badge variant="outline">
                    {t.graph.inbound(selectedNeighbors.inbound.length)}
                  </Badge>
                ) : null}
                {selectedNeighbors.outbound.length > 0 ? (
                  <Badge variant="outline">
                    {t.graph.outbound(selectedNeighbors.outbound.length)}
                  </Badge>
                ) : null}
              </div>

              {(selectedNeighbors.inbound.length > 0 || selectedNeighbors.outbound.length > 0) && (
                <div className="mt-3 flex max-h-28 flex-col gap-2 overflow-y-auto text-xs">
                  {selectedNeighbors.outbound.length > 0 ? (
                    <div>
                      <p className="text-muted-foreground mb-1 font-medium uppercase tracking-wide">
                        {t.graph.linksTo}
                      </p>
                      <ul className="flex flex-col gap-0.5">
                        {selectedNeighbors.outbound.slice(0, 4).map((node) => (
                          <li key={node.id}>
                            <button
                              type="button"
                              dir="auto"
                              onClick={() => focusNode(node.id)}
                              className="text-foreground hover:text-primary w-full truncate text-start transition-colors duration-150"
                            >
                              {node.title}
                            </button>
                          </li>
                        ))}
                        {selectedNeighbors.outbound.length > 4 ? (
                          <li className="text-muted-foreground">
                            {t.graph.more(selectedNeighbors.outbound.length - 4)}
                          </li>
                        ) : null}
                      </ul>
                    </div>
                  ) : null}
                  {selectedNeighbors.inbound.length > 0 ? (
                    <div>
                      <p className="text-muted-foreground mb-1 font-medium uppercase tracking-wide">
                        {t.graph.linkedFrom}
                      </p>
                      <ul className="flex flex-col gap-0.5">
                        {selectedNeighbors.inbound.slice(0, 4).map((node) => (
                          <li key={node.id}>
                            <button
                              type="button"
                              dir="auto"
                              onClick={() => focusNode(node.id)}
                              className="text-foreground hover:text-primary w-full truncate text-start transition-colors duration-150"
                            >
                              {node.title}
                            </button>
                          </li>
                        ))}
                        {selectedNeighbors.inbound.length > 4 ? (
                          <li className="text-muted-foreground">
                            {t.graph.more(selectedNeighbors.inbound.length - 4)}
                          </li>
                        ) : null}
                      </ul>
                    </div>
                  ) : null}
                </div>
              )}

              <Link
                href={`/sources/${bundleSlug}/${selectedNode.path}`}
                className="text-primary hover:text-primary/80 mt-3 inline-flex items-center gap-1 text-xs font-medium transition-colors duration-150"
              >
                {t.graph.openPage}
                <ArrowRight className="size-3.5 rtl:rotate-180" />
              </Link>
            </div>
          ) : (
            <p className="text-muted-foreground animate-in fade-in pointer-events-none absolute bottom-3 start-3 rounded-full border bg-[color-mix(in_oklch,var(--card)_90%,transparent)] px-3 py-1.5 text-xs backdrop-blur-sm duration-500">
              {t.graph.hint}
            </p>
          )}
        </div>
      )}

      <p className="text-muted-foreground text-xs leading-relaxed">{t.graph.footerHelp}</p>
    </div>
  );
}
