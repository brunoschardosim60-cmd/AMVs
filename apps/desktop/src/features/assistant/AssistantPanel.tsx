import {
  closeSelection,
  localTurn,
  ProviderError,
  runTurn,
  summarizeChangeSet,
  validateSelection,
  type AssistantContext,
  type ChangeSet,
  type ChatMessage,
} from '@amv/assistant';
import type { EpisodeAnalysis, EpisodeVision, MusicAnalysis } from '@amv/analysis';
import { Bot, Check, Eye, Loader2, Minus, Send, Settings2, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { isLocal, loadAiSettings, saveAiSettings, secretName, type AiSettings } from '../../core/aiSettings';
import type { ProjectSession } from '../../core/session';
import { useApp, useSessionVersion } from '../../store';
import { Button } from '../../ui/controls';
import { useEditor } from '../editor/editorStore';
import { AiSettingsDialog } from './AiSettingsDialog';

interface Entry {
  id: number;
  role: 'user' | 'assistant' | 'error';
  text: string;
  proposals?: ChangeSet[];
}

const QUICK = ['Analise meu AMV', 'Ideias para este AMV', 'Deixe os cortes mais rápidos', 'Coloque um grito antes do drop', 'Troque essa cena por uma mais forte', 'Clarão nas batidas'];

function buildContext(session: ProjectSession): AssistantContext {
  const music = new Map<string, MusicAnalysis>();
  const episodes = new Map<string, EpisodeAnalysis>();
  const visions = new Map<string, EpisodeVision>();
  for (const a of session.project.assets) {
    if (a.tags.includes('sfx')) continue;
    const rt = session.assetRuntime(a.id);
    if (rt.music) music.set(a.id, rt.music);
    if (rt.episode) episodes.set(a.id, rt.episode);
    if (rt.vision) visions.set(a.id, rt.vision);
  }
  const ed = useEditor.getState();
  return { project: session.project, selection: ed.selection, playheadUs: ed.playheadUs, music, episodes, visions };
}


// ---------------------------------------------------------------- janela flutuante

const POS_KEY = 'amv.assistant.pos';
type Pos = { x: number; y: number };

function loadPos(): Pos {
  try {
    const raw = window.localStorage.getItem(POS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Pos;
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) return p;
    }
  } catch {
    /* sem armazenamento: usa o padrão */
  }
  return { x: Math.max(8, window.innerWidth - 384), y: 72 };
}

const PANEL_W = 380;
const BUBBLE = 44;
/** Mantém a janela (ou a bolinha) inteira na tela, mesmo se a janela do app diminuir. */
const clampPos = (p: Pos, w = PANEL_W): Pos => ({ x: Math.max(0, Math.min(p.x, window.innerWidth - Math.min(w, window.innerWidth))), y: Math.max(0, Math.min(p.y, window.innerHeight - 44)) });

/**
 * Posição e arrasto da janela do assistente. Arrastar pelo cabeçalho; o clique curto na
 * bolinha (minimizado) reabre. Não ocupa espaço no layout: flutua sobre o editor.
 */
function useFloating() {
  const [pos, setPos] = useState<Pos>(() => clampPos(loadPos()));
  const [minimized, setMinimized] = useState(false);
  const drag = useRef<{ dx: number; dy: number; sx: number; sy: number; moved: boolean } | null>(null);
  const posRef = useRef(pos);
  posRef.current = pos;
  const minimizedRef = useRef(minimized);
  minimizedRef.current = minimized;
  /** O último gesto foi um arrasto (então o `click` que vem junto não deve abrir a bolinha). */
  const dragged = useRef(false);
  useEffect(() => {
    const w = minimized ? BUBBLE : PANEL_W;
    const fit = () => setPos((p) => clampPos(p, w));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [minimized]);
  const handlers = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      // botões/campos dentro do cabeçalho não arrastam; mas a própria bolinha (que é um botão) arrasta
      const hit = (e.target as HTMLElement).closest('button, input, textarea, select');
      if (hit && hit !== e.currentTarget) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { dx: e.clientX - posRef.current.x, dy: e.clientY - posRef.current.y, sx: e.clientX, sy: e.clientY, moved: false };
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d) return;
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) d.moved = true;
      if (d.moved) setPos(clampPos({ x: e.clientX - d.dx, y: e.clientY - d.dy }, minimizedRef.current ? BUBBLE : PANEL_W));
    },
    onPointerUp: () => {
      const d = drag.current;
      drag.current = null;
      dragged.current = !!d?.moved;
      if (d?.moved) {
        try {
          window.localStorage.setItem(POS_KEY, JSON.stringify(posRef.current));
        } catch {
          /* ignora */
        }
      }
      return d;
    },
  };
  /** Clique na bolinha: abre, a não ser que o gesto tenha sido um arrasto. Também vale para Enter/Espaço. */
  const openFromBubble = () => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    setMinimized(false);
  };
  return { pos, minimized, setMinimized, handlers, openFromBubble };
}

let seq = 0;

/** Conversa sobrevive a fechar e abrir o painel (por projeto, enquanto o app está aberto). */
const memory = new Map<string, { entries: Entry[]; history: ChatMessage[] }>();

/** Chat do assistente: conversa, ideias e propostas com aprovação parcial. */
export function AssistantPanel({ session, onClose }: { session: ProjectSession; onClose: () => void }) {
  useSessionVersion(session);
  const { platform, toast } = useApp();
  const float = useFloating();
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const saved = memory.get(session.project.id);
  const [entries, setEntries] = useState<Entry[]>(saved?.entries ?? []);
  const [history, setHistory] = useState<ChatMessage[]>(saved?.history ?? []);
  useEffect(() => {
    memory.set(session.project.id, { entries, history });
  }, [entries, history, session.project.id]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const selection = useEditor((s) => s.selection);
  const draft = useEditor((s) => s.assistantDraft);
  const visionAssetIds = [...new Set(session.project.clips.flatMap((clip) => {
    if (!clip.assetId) return [];
    const asset = session.project.assets.find((item) => item.id === clip.assetId);
    return asset?.kind === 'video' ? [asset.id] : [];
  }))].sort().join(',');
  useEffect(() => {
    if (draft) {
      setInput(draft);
      useEditor.setState({ assistantDraft: null });
    }
  }, [draft]);

  useEffect(() => {
    if (platform) void loadAiSettings(platform).then(setSettings);
  }, [platform]);
  useEffect(() => {
    const videoIds = visionAssetIds ? visionAssetIds.split(',') : [];
    void Promise.all(videoIds.map((id) => session.loadVision(id))).catch((error: unknown) => {
      toast({ tone: 'warn', title: 'Não foi possível carregar parte da análise visual', body: error instanceof Error ? error.message : String(error) });
    });
  }, [session, visionAssetIds, toast]);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' });
  }, [entries, busy]);

  const modelOn = !!settings?.enabled && (isLocal(settings) || settings.allowExternal);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy || !platform || !settings) return;
    setInput('');
    setEntries((e) => [...e, { id: ++seq, role: 'user', text: q }]);
    const ctx = buildContext(session);
    if (!modelOn) {
      const r = localTurn(ctx, q);
      setEntries((e) => [...e, { id: ++seq, role: 'assistant', text: r.reply, proposals: r.proposals }]);
      return;
    }
    setBusy(true);
    abort.current = new AbortController();
    try {
      const key = settings.provider.needsKey ? await platform.secrets.get(secretName(settings.presetId)) : null;
      const r = await runTurn({ cfg: settings.provider, key, fetch: platform.http, ctx, history, question: q, signal: abort.current.signal });
      setHistory(r.messages);
      setEntries((e) => [...e, { id: ++seq, role: 'assistant', text: r.reply || '(sem resposta)', proposals: r.proposals }]);
      const next = { ...settings, usage: { input: settings.usage.input + r.usage.input, output: settings.usage.output + r.usage.output } };
      setSettings(next);
      void saveAiSettings(platform, next);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      if (settings.provider.kind === 'gemini' && e instanceof ProviderError && e.retryable) {
        const fallback = localTurn(ctx, q);
        setEntries((x) => [...x, {
          id: ++seq,
          role: 'assistant',
          text: `Gemini indisponível (${e.message}). Resposta do modo local, sem modelo: ${fallback.reply}`,
          proposals: fallback.proposals,
        }]);
      } else {
        setEntries((x) => [...x, { id: ++seq, role: 'error', text: e instanceof ProviderError ? e.message : `Erro: ${(e as Error).message}` }]);
      }
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  return (
    <>
    {float.minimized && (
      <button
        type="button"
        aria-label="Abrir assistente"
        title="Assistente (arraste para mover)"
        className="fixed z-[35] grid size-11 touch-none place-items-center rounded-full border border-violet bg-panel text-violet-strong shadow-xl hover:bg-raised"
        style={{ left: float.pos.x, top: float.pos.y }}
        onPointerDown={float.handlers.onPointerDown}
        onPointerMove={float.handlers.onPointerMove}
        onPointerUp={(e) => {
          float.handlers.onPointerUp();
          e.currentTarget.releasePointerCapture?.(e.pointerId);
        }}
        onClick={float.openFromBubble}
      >
        <Bot size={20} />
        {busy && <Loader2 size={12} className="absolute -top-0.5 -right-0.5 animate-spin text-violet-strong" />}
      </button>
    )}
    <aside
      className={`assistant-floating-panel fixed z-[35] flex-col rounded-xl border border-line bg-panel ${float.minimized ? 'hidden' : 'flex'}`}
      style={{ left: float.pos.x, top: float.pos.y, width: 380, height: 540, minWidth: 300, minHeight: 320, maxWidth: '92vw', maxHeight: 'calc(100vh - 16px)', resize: 'both', overflow: 'hidden' }}
      aria-label="Assistente"
    >
      <header
        className="flex h-10 shrink-0 cursor-move touch-none items-center gap-2 border-b border-line px-3 select-none"
        title="Arraste para mover"
        onPointerDown={float.handlers.onPointerDown}
        onPointerMove={float.handlers.onPointerMove}
        onPointerUp={(e) => {
          float.handlers.onPointerUp();
          e.currentTarget.releasePointerCapture?.(e.pointerId);
        }}
      >
        <Bot size={16} className="text-violet-strong" />
        <span className="text-sm font-semibold">Assistente</span>
        <span className={`rounded px-1.5 py-0.5 text-2xs ${modelOn ? 'bg-violet/15 text-violet-strong' : 'bg-raised text-muted'}`} title={modelOn ? `${settings!.provider.name} · ${settings!.provider.model}` : 'Sem modelo: entende pedidos diretos'}>
          {modelOn ? settings!.provider.model || settings!.provider.name : 'modo local'}
        </span>
        <button type="button" aria-label="Configurações de IA" className="ml-auto rounded p-1 text-muted hover:bg-raised hover:text-ink" onClick={() => setShowSettings(true)}>
          <Settings2 size={15} />
        </button>
        <button type="button" aria-label="Minimizar assistente" title="Minimizar (vira uma bolinha)" className="rounded p-1 text-muted hover:bg-raised hover:text-ink" onClick={() => float.setMinimized(true)}>
          <Minus size={15} />
        </button>
        <button type="button" aria-label="Fechar assistente" className="rounded p-1 text-muted hover:bg-raised hover:text-ink" onClick={onClose}>
          <X size={15} />
        </button>
      </header>

      <div ref={list} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {entries.length === 0 && (
          <div className="text-xs text-muted">
            <p className="mb-2 text-ink-soft">
              Eu vejo a timeline, a música e os episódios analisados. Peço sua aprovação antes de mudar qualquer coisa.
              {!modelOn && ' Sem modelo de IA ligado eu entendo pedidos diretos; ligue um modelo na engrenagem para conversar livremente.'}
            </p>
            <div className="flex flex-wrap gap-1">
              {QUICK.map((q) => (
                <button key={q} type="button" className="rounded-full border border-line px-2.5 py-1 text-2xs text-ink-soft hover:border-violet hover:text-ink" onClick={() => void ask(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {entries.map((e) => (
          <div key={e.id}>
            {e.role === 'user' ? (
              <p className="ml-8 rounded-lg rounded-br-sm bg-violet/20 px-3 py-2 text-xs whitespace-pre-wrap text-ink">{e.text}</p>
            ) : (
              <div className={`mr-4 rounded-lg rounded-bl-sm px-3 py-2 text-xs whitespace-pre-wrap ${e.role === 'error' ? 'border border-danger/40 bg-danger/10 text-ink' : 'bg-raised text-ink'}`}>{e.text}</div>
            )}
            {e.proposals?.map((p) => <ProposalCard key={p.id} session={session} cs={p} />)}
          </div>
        ))}
        {busy && (
          <p className="flex items-center gap-2 text-xs text-muted">
            <Loader2 size={13} className="animate-spin" /> pensando…
            <button type="button" className="underline" onClick={() => abort.current?.abort()}>
              parar
            </button>
          </p>
        )}
      </div>

      <form
        className="border-t border-line p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
      >
        {selection.length > 0 && (
          <p className="mb-1 flex items-center gap-1 text-2xs text-muted">
            <Sparkles size={11} /> falando sobre {selection.length} clipe(s) selecionado(s)
          </p>
        )}
        <div className="flex items-end gap-1">
          <textarea
            rows={2}
            className="min-w-0 flex-1 resize-none rounded-control border border-line bg-base px-2 py-1.5 text-xs outline-none focus:border-violet"
            placeholder='Ex.: "coloque essa fala antes do drop"'
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation(); // atalhos do editor não disparam enquanto digita
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void ask(input);
              }
            }}
          />
          <button type="submit" aria-label="Enviar" disabled={busy || !input.trim()} className="grid size-9 place-items-center rounded-control bg-violet text-white disabled:opacity-40">
            <Send size={14} />
          </button>
        </div>
      </form>
      {showSettings && settings && (
        <AiSettingsDialog
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSave={(s) => {
            setSettings(s);
            void saveAiSettings(platform!, s).catch((e) => toast({ tone: 'error', title: 'Não deu para salvar', body: (e as Error).message }));
          }}
        />
      )}
    </aside>
    </>
  );
}

type CardState = 'open' | 'testing' | 'applied' | 'discarded';
const cardMemory = new Map<string, { picked: Set<string>; state: CardState }>();

const KIND_COLOR = { add: 'text-ok', remove: 'text-danger', move: 'text-[#4fc3f7]', modify: 'text-warn' } as const;
const KIND_LABEL = { add: '+', remove: '−', move: '→', modify: '~' } as const;

/** Revisão da proposta: escolher itens, testar (A/B), aplicar. */
function ProposalCard({ session, cs }: { session: ProjectSession; cs: ChangeSet }) {
  const { toast } = useApp();
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const [picked, setPicked] = useState<Set<string>>(() => cardMemory.get(cs.id)?.picked ?? new Set(cs.items.map((i) => i.id)));
  const [state, setState] = useState<CardState>(() => cardMemory.get(cs.id)?.state ?? 'open');
  useEffect(() => {
    cardMemory.set(cs.id, { picked, state });
  }, [cs.id, picked, state]);
  // mostra na timeline onde a proposta mexe enquanto está em revisão
  useEffect(() => {
    if (state !== 'open') return;
    const marks = cs.items.filter((i) => picked.has(i.id) && i.atUs !== null).map((i) => ({ atUs: i.atUs!, kind: i.kind }));
    useEditor.setState({ proposalMarks: marks });
    return () => useEditor.setState({ proposalMarks: [] });
  }, [cs, picked, state]);
  const label = `IA: ${cs.title}`;

  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) {
      next.delete(id);
      const closed = closeSelection(cs, next);
      const dropped = [...next].filter((x) => !closed.has(x));
      if (dropped.length) toast({ tone: 'info', title: `${dropped.length} item(ns) dependem deste e saíram junto` });
      setPicked(closed);
    } else {
      next.add(id);
      // marcar um item marca o que ele precisa
      const need = (x: string) => cs.items.find((i) => i.id === x)?.dependsOn.forEach((d) => (next.add(d), need(d)));
      need(id);
      setPicked(next);
    }
  };

  const apply = () => {
    const v = validateSelection(session.project, cs, picked);
    if (!v.ok) {
      toast({ tone: 'error', title: 'A proposta não serve mais', body: `${v.error}. Peça de novo.` });
      return false;
    }
    session.history.transaction(label, v.commands);
    return true;
  };

  const undoTest = () => {
    if (session.history.undoLabel === label) session.undo();
  };

  if (state === 'discarded') return <p className="mt-1 text-2xs text-faint">Proposta descartada.</p>;
  if (state === 'applied')
    return (
      <p className="mt-1 flex items-center gap-1 text-2xs text-ok">
        <Check size={12} /> Aplicado ({picked.size} de {cs.items.length}). Ctrl+Z desfaz.
      </p>
    );

  return (
    <div className="mt-2 rounded-lg border border-violet/40 bg-base p-2.5">
      <p className="text-xs font-semibold">{cs.title}</p>
      <p className="text-2xs text-muted">{cs.reason}</p>
      <p className="mt-1 text-2xs text-ink-soft">{summarizeChangeSet(cs)}</p>
      <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto">
        {cs.items.map((it) => (
          <li key={it.id} className="flex items-start gap-1.5 text-2xs">
            <input type="checkbox" className="mt-0.5 accent-violet" disabled={state === 'testing'} checked={picked.has(it.id)} onChange={() => toggle(it.id)} />
            <span className={`w-2 font-bold ${KIND_COLOR[it.kind]}`}>{KIND_LABEL[it.kind]}</span>
            <span className="min-w-0 flex-1 text-ink-soft">{it.label}</span>
            {it.atUs !== null && (
              <button type="button" aria-label="Ver na timeline" className="text-muted hover:text-ink" onClick={() => setPlayhead(it.atUs!)}>
                <Eye size={11} />
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap gap-1">
        {state === 'open' ? (
          <>
            <Button size="sm" variant="primary" disabled={!picked.size} onClick={() => apply() && setState('applied')}>
              Aplicar {picked.size < cs.items.length ? `${picked.size}` : 'tudo'}
            </Button>
            <Button size="sm" disabled={!picked.size} onClick={() => apply() && setState('testing')} title="Aplica na timeline para você ver e ouvir; dá para voltar">
              Testar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setState('discarded')}>
              Descartar
            </Button>
          </>
        ) : (
          <>
            <span className="w-full text-2xs text-warn">Testando: toque o preview. Compare com o original quando quiser.</span>
            <Button size="sm" variant="primary" onClick={() => setState('applied')}>
              Manter
            </Button>
            <Button size="sm" onClick={() => (undoTest(), setState('open'))}>
              Voltar ao original
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
