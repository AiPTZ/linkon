import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  type EdgeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Save,
  Trash2,
  Workflow,
  Eraser,
  Box,
  XCircle,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import { BLOCK_DEFS, BLOCK_ORDER, blockSubtitle, defaultTemplate, emptyFlow, validateClientFlow } from "../lib/flow";
import type { BlockType, Flow } from "../types";

export type BlockNodeData = Record<string, unknown> & {
  type: BlockType;
  message?: string;
  noMessage?: boolean;
  minutes?: number;
  conditionType?: "accepted" | "replied" | "contains";
  keyword?: string;
};

type BlockNode = Node<BlockNodeData, "block">;

const FlowEditorContext = createContext<{ deleteNode: (id: string) => void }>({
  deleteNode: () => undefined,
});

function genId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}

function toRFNodes(flow: Flow): BlockNode[] {
  return flow.nodes.map((n) => ({
    id: n.id,
    type: "block",
    position: n.position,
    data: { ...(n.data as Record<string, unknown>), type: n.type } as BlockNodeData,
  }));
}

function toRFEdges(flow: Flow): Edge[] {
  return flow.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    label: e.label,
  }));
}

function fromFlow(nodes: BlockNode[], edges: Edge[]): Flow {
  return {
    nodes: nodes.map((n) => ({ id: n.id, type: n.data.type, position: n.position, data: n.data })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      label: typeof e.label === "string" ? e.label : undefined,
    })),
  };
}

function FlowBlockNode({ data, selected, id }: NodeProps<BlockNode>) {
  const def = BLOCK_DEFS[data.type] ?? BLOCK_DEFS.start;
  const Icon = def.icon;
  const isCondition = data.type === "condition";
  const { deleteNode } = useContext(FlowEditorContext);
  return (
    <div
      className={`flow-block ${selected ? "flow-block-selected" : ""}`}
      style={{ borderTopColor: def.color }}
    >
      <Handle type="target" position={Position.Left} className="flow-handle" />
      <button
        type="button"
        className="flow-node-delete"
        aria-label={`Excluir bloco ${def.label}`}
        title="Excluir bloco"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          deleteNode(id);
        }}
      >
        <X className="h-3 w-3" />
      </button>
      <div className="flex items-center gap-2 py-1.5 pl-2 pr-7">
        <span
          className="grid h-6 w-6 shrink-0 place-items-center rounded-md"
          style={{ background: `${def.color}26`, color: def.color }}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold leading-tight" style={{ color: def.color }}>
            {def.label}
          </div>
          <div className="max-w-52 truncate text-[10px] text-cream/50">
            {blockSubtitle(data)}
          </div>
        </div>
      </div>
      {!isCondition && <Handle type="source" position={Position.Right} id="out" className="flow-handle" />}
      {isCondition && (
        <>
          <div className="flex justify-around px-2 pb-0.5 text-[9px] uppercase tracking-wide text-cream/40">
            <span>sim</span>
            <span>não</span>
          </div>
          <Handle
            type="source"
            position={Position.Bottom}
            id="sim"
            className="flow-handle flow-handle-sim"
            style={{ left: "30%" }}
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="nao"
            className="flow-handle flow-handle-nao"
            style={{ left: "70%" }}
          />
        </>
      )}
    </div>
  );
}

const nodeTypes = { block: FlowBlockNode };

const defaultEdgeOptions = {
  style: { stroke: "#d4af37", strokeWidth: 1.5 },
  labelStyle: { fill: "#a89060", fontSize: 10, fontWeight: 600 as const },
  labelBgStyle: { fill: "#16130d", fillOpacity: 0.95 },
  labelBgPadding: [4, 2] as [number, number],
};

interface FlowEditorProps {
  initialFlow?: Flow;
  onSave: (flow: Flow) => void | Promise<void>;
  saving?: boolean;
}

export function FlowEditor({ initialFlow, onSave, saving = false }: FlowEditorProps) {
  return (
    <ReactFlowProvider>
      <FlowEditorInner initialFlow={initialFlow} onSave={onSave} saving={saving} />
    </ReactFlowProvider>
  );
}

function FlowEditorInner({ initialFlow, onSave, saving = false }: FlowEditorProps) {
  const initial = initialFlow ?? emptyFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<BlockNode>(toRFNodes(initial));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(toRFEdges(initial));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const rf = useReactFlow();

  const selected = useMemo(() => nodes.find((n) => n.id === selectedId) ?? null, [nodes, selectedId]);

  useEffect(() => {
    if (!fullscreen) return;
    const t = setTimeout(() => rf.fitView({ padding: 0.2 }), 80);
    return () => clearTimeout(t);
  }, [fullscreen, rf]);

  const deleteNodeById = useCallback(
    (id: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== id));
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
      setSelectedId((s) => (s === id ? null : s));
    },
    [setNodes, setEdges],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      setEdges((eds) => {
        const without = eds.filter(
          (e) =>
            !(e.source === conn.source && (e.sourceHandle ?? "out") === (conn.sourceHandle ?? "out")),
        );
        return addEdge(
          {
            ...conn,
            id: genId(),
            label:
              conn.sourceHandle === "sim" ? "SIM" : conn.sourceHandle === "nao" ? "NÃO" : undefined,
          },
          without,
        );
      });
    },
    [setEdges],
  );

  const addBlock = useCallback(
    (type: BlockType) => {
      if (type === "start" && nodes.some((n) => n.data.type === "start")) return;
      const id = genId();
      const count = nodes.length;
      const position = { x: (count % 3) * 300, y: Math.floor(count / 3) * 150 };
      setNodes((nds) => [...nds, { id, type: "block", position, data: { type } }]);
      setSelectedId(id);
    },
    [nodes, setNodes],
  );

  const patchSelected = useCallback(
    (patch: Partial<BlockNodeData>) => {
      if (!selectedId) return;
      setNodes((nds) =>
        nds.map((n) => (n.id === selectedId ? { ...n, data: { ...n.data, ...patch } } : n)),
      );
    },
    [selectedId, setNodes],
  );

  const deleteSelected = useCallback(() => {
    if (selectedId) deleteNodeById(selectedId);
  }, [selectedId, deleteNodeById]);

  const clearFlow = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setSelectedId(null);
  }, [setNodes, setEdges]);

  const loadTemplate = useCallback(() => {
    const tpl = defaultTemplate();
    setNodes(toRFNodes(tpl));
    setEdges(toRFEdges(tpl));
    setSelectedId(null);
  }, [setNodes, setEdges]);

  const validation = useMemo(() => validateClientFlow(fromFlow(nodes, edges)), [nodes, edges]);

  const def = selected ? BLOCK_DEFS[selected.data.type] : null;
  const Icon = def?.icon ?? Box;

  return (
    <div
      className={`space-y-3 ${
        fullscreen
          ? "fixed inset-0 z-50 flex flex-col overflow-auto bg-ink/85 p-4 backdrop-blur-2xl sm:p-6"
          : ""
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="label !mb-0 mr-1">Blocos</span>
          {BLOCK_ORDER.map((t) => {
            const d = BLOCK_DEFS[t];
            const disabled = t === "start" && nodes.some((n) => n.data.type === "start");
            return (
              <button
                key={t}
                type="button"
                disabled={disabled}
                onClick={() => addBlock(t)}
                title={d.description}
                className="btn btn-secondary !px-2.5 !py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                style={{ color: d.color }}
              >
                <d.icon className="h-3.5 w-3.5" />
                {d.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={loadTemplate} className="btn btn-secondary !px-2.5 !py-1.5 text-xs">
            <Workflow className="h-3.5 w-3.5" />
            Modelo
          </button>
          <button type="button" onClick={clearFlow} className="btn btn-secondary !px-2.5 !py-1.5 text-xs">
            <Eraser className="h-3.5 w-3.5" />
            Limpar
          </button>
          <button
            type="button"
            onClick={() => setFullscreen((v) => !v)}
            className="btn btn-secondary !px-2.5 !py-1.5 text-xs"
            aria-label={fullscreen ? "Sair da tela cheia" : "Tela cheia"}
            title={fullscreen ? "Sair da tela cheia" : "Tela cheia"}
          >
            {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            {fullscreen ? "Sair" : "Tela cheia"}
          </button>
        </div>
      </div>

      <div className="flex gap-3">
        <div
          className={`card relative min-w-0 flex-1 overflow-hidden !p-0 ${
            fullscreen ? "h-[calc(100dvh-210px)] min-h-[420px]" : "h-[calc(100dvh-250px)] min-h-[580px]"
          }`}
          onClick={() => setSelectedId(null)}
        >
          <FlowEditorContext.Provider value={{ deleteNode: deleteNodeById }}>
            <ReactFlow<BlockNode>
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_e, node) => setSelectedId(node.id)}
              onPaneClick={() => setSelectedId(null)}
              nodeTypes={nodeTypes}
              defaultEdgeOptions={defaultEdgeOptions}
              deleteKeyCode={["Backspace", "Delete"]}
              colorMode="dark"
              proOptions={{ hideAttribution: true }}
              fitView
            >
              <Background color="#3a3a3a" gap={20} size={1} />
              <Controls className="!bg-ink-800 !border !border-ink-600" showInteractive={false} />
              <MiniMap
                className="!bg-ink-800 !border !border-ink-600"
                nodeColor={(n) => BLOCK_DEFS[(n.data as BlockNodeData)?.type]?.color ?? "#64748b"}
                maskColor="rgba(0,0,0,0.55)"
              />
            </ReactFlow>
          </FlowEditorContext.Provider>
          <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-md border border-ink-600 bg-ink-800/90 px-2 py-1 text-[10px] text-cream/50">
            {nodes.length} bloco{nodes.length === 1 ? "" : "s"} · {edges.length} conexão
            {edges.length === 1 ? "" : "ões"}
          </div>
        </div>

        <aside className="w-72 shrink-0">
          <div className={`card space-y-3 p-4 ${fullscreen ? "max-h-[calc(100dvh-210px)] overflow-auto" : "sticky top-4"}`}>
            {!selected ? (
              <div className="py-6 text-center">
                <Box className="mx-auto h-8 w-8 text-cream/30" />
                <p className="mt-2 text-sm text-cream/50">
                  Clique em um bloco para editar suas propriedades.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span
                    className="inline-flex items-center gap-2 text-sm font-semibold"
                    style={{ color: def?.color }}
                  >
                    <Icon className="h-4 w-4" />
                    {def?.label}
                  </span>
                  <button
                    type="button"
                    onClick={deleteSelected}
                    className="btn btn-danger !px-2 !py-1.5"
                    aria-label="Excluir bloco"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                {selected.data.type === "invite" && (
                  <div className="space-y-3">
                    <label className="flex cursor-pointer items-start gap-2 text-sm text-cream/80">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 accent-gold-500"
                        checked={Boolean(selected.data.noMessage)}
                        onChange={(e) =>
                          patchSelected({
                            noMessage: e.target.checked,
                            ...(e.target.checked ? { message: "" } : {}),
                          })
                        }
                      />
                      <span>Enviar convite sem mensagem</span>
                    </label>
                    {Boolean(selected.data.noMessage) ? (
                      <p className="text-xs leading-relaxed text-cream/40">
                        O convite vai sem nota. Encadeie um bloco &quot;Quando aceitar&quot; seguido de
                        &quot;Mensagem&quot; para enviar a conversa assim que o lead aceitar.
                      </p>
                    ) : (
                      <div>
                        <label className="label">Mensagem do convite *</label>
                        <textarea
                          className="input min-h-24 resize-y"
                          maxLength={300}
                          value={String(selected.data.message ?? "")}
                          onChange={(e) => patchSelected({ message: e.target.value })}
                          placeholder="Olá! Vi seu perfil e gostaria de trocar experiências..."
                        />
                      </div>
                    )}
                  </div>
                )}

                {selected.data.type === "message" && (
                  <div>
                    <label className="label">Texto da mensagem *</label>
                    <textarea
                      className="input min-h-24 resize-y"
                      maxLength={2000}
                      value={String(selected.data.message ?? "")}
                      onChange={(e) => patchSelected({ message: e.target.value })}
                      placeholder="Mensagem enviada quando o lead aceitar o convite..."
                    />
                  </div>
                )}

                {selected.data.type === "wait" && (
                  <div>
                    <label className="label">Duração (minutos)</label>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      value={Number(selected.data.minutes ?? 30)}
                      onChange={(e) => patchSelected({ minutes: Math.max(1, Number(e.target.value)) })}
                    />
                    <p className="mt-1 text-xs text-cream/40">
                      O fluxo espera esse tempo antes de seguir para o próximo bloco.
                    </p>
                  </div>
                )}

                {selected.data.type === "condition" && (
                  <>
                    <div>
                      <label className="label">Condição</label>
                      <select
                        className="input"
                        value={String(selected.data.conditionType ?? "")}
                        onChange={(e) =>
                          patchSelected({ conditionType: e.target.value as BlockNodeData["conditionType"] })
                        }
                      >
                        <option value="">Selecione...</option>
                        <option value="accepted">Se o lead aceitou o convite</option>
                        <option value="replied">Se o lead respondeu</option>
                        <option value="contains">Se a mensagem contém palavra</option>
                      </select>
                    </div>
                    {selected.data.conditionType === "contains" && (
                      <div>
                        <label className="label">Palavra</label>
                        <input
                          className="input"
                          value={String(selected.data.keyword ?? "")}
                          onChange={(e) => patchSelected({ keyword: e.target.value })}
                          placeholder="ex: preço"
                        />
                      </div>
                    )}
                    <p className="text-xs text-cream/40">
                      Conecte a saída <span className="font-semibold text-emerald-400">SIM</span> e a
                      saída <span className="font-semibold text-red-400">NÃO</span> do bloco.
                    </p>
                  </>
                )}

                {["start", "on_accept", "on_reply", "stop"].includes(selected.data.type) && (
                  <p className="text-xs leading-relaxed text-cream/50">{def?.description}.</p>
                )}
              </>
            )}

            {validation.length > 0 && (
              <div className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                {validation.map((v, i) => (
                  <p key={i} className="flex items-start gap-1.5 text-xs text-amber-300">
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {v}
                  </p>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => onSave(fromFlow(nodes, edges))}
              disabled={saving || validation.length > 0}
              className="btn btn-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Salvando..." : "Salvar fluxo"}
              {!saving && <Save className="h-4 w-4" />}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

export type { EdgeProps };
