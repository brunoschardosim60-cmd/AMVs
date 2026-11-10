import type { MusicAnalysis } from '@amv/analysis';
import { buildMusicMap } from '@amv/automv';

const W = 760;
const H = 112;
const EVENT_COLORS: Record<string, string> = {
  onset: '#7f8da8',
  impact: '#ffb454',
  growth: '#72d6a0',
  pause: '#7bb7ff',
  drop: '#d58cff',
  'section-change': '#b3a5ff',
  'rhythm-change': '#ff8b9b',
};

const SECTION_COLORS: Record<string, string> = {
  intro: '#5874a6',
  verso: '#527b87',
  'pré-refrão': '#a47a4f',
  refrão: '#965e83',
  drop: '#ac61cf',
  ponte: '#66718d',
  final: '#527d68',
};

export function MusicalMap({ analysis, range }: { analysis: MusicAnalysis; range: [number, number] }) {
  const map = buildMusicMap(analysis, range);
  const duration = map.endS - map.startS;
  if (duration <= 0) return null;
  const x = (timeS: number) => Math.max(0, Math.min(W, (timeS / duration) * W));
  const y = (value: number) => 47 - Math.max(0, Math.min(1, value)) * 34;
  const points = map.energy.map((point) => `${x(point.timeS)},${y(point.value)}`).join(' ');
  const visibleEvents = map.events.filter((event) => event.type !== 'onset');
  const onsets = map.events.filter((event) => event.type === 'onset');
  const onsetStride = Math.max(1, Math.ceil(onsets.length / 500));

  return (
    <div className="mt-2 rounded-control border border-line-soft bg-base/70 p-2">
      <div className="mb-1 flex items-center justify-between gap-2 text-2xs">
        <span className="font-medium text-ink-soft">Mapa musical · trecho selecionado</span>
        <span className="tnum text-muted">
          {analysis.bpm} BPM · pulso {Math.round(analysis.bpmConfidence * 100)}% · {onsets.length} ataques
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Mapa de energia, compassos e eventos musicais" className="h-24 w-full overflow-visible">
        <line x1="0" x2={W} y1="48" y2="48" stroke="#38404d" strokeWidth="1" />
        {map.sections.map((section, index) => (
          <g key={`${section.startS}-${index}`}>
            <rect
              x={x(section.startS)}
              y="0"
              width={Math.max(1, x(section.endS) - x(section.startS))}
              height="13"
              fill={SECTION_COLORS[section.label] ?? '#66718d'}
              opacity="0.35"
            />
            {x(section.endS) - x(section.startS) > 40 && (
              <text x={x(section.startS) + 3} y="10" fill="#d2d7e2" fontSize="8">{section.label}</text>
            )}
          </g>
        ))}
        {map.downbeats.map((timeS, index) => (
          <line key={`beat-${index}`} x1={x(timeS)} x2={x(timeS)} y1="51" y2="58" stroke="#9ba8bd" strokeWidth="1" opacity="0.55" />
        ))}
        {onsets.filter((_, index) => index % onsetStride === 0).map((event, index) => (
          <line
            key={`onset-${index}`}
            x1={x(event.timelineS)}
            x2={x(event.timelineS)}
            y1="61"
            y2={61 + event.confidence * 8}
            stroke={EVENT_COLORS.onset}
            strokeWidth="1"
            opacity="0.45"
          >
            <title>Ataque espectral · {event.band ?? 'banda não classificada'} · suporte heurístico {Math.round(event.confidence * 100)}%</title>
          </line>
        ))}
        <polyline points={points} fill="none" stroke="#a98aff" strokeWidth="1.7" vectorEffect="non-scaling-stroke" />
        {visibleEvents.map((event, index) => {
          const color = EVENT_COLORS[event.type] ?? '#b3a5ff';
          const center = x(event.timelineS);
          const lane = event.type === 'drop' ? 22 : event.type === 'growth' ? 72 : event.type === 'pause' ? 88 : event.type === 'impact' ? 96 : 80;
          return (
            <g key={`${event.type}-${event.atS}-${index}`} opacity={0.45 + event.confidence * 0.55}>
              {event.durationS ? (
                <rect x={center} y={lane - 3} width={Math.max(2, x(event.durationS) - x(0))} height="5" rx="2" fill={color}>
                  <title>{event.type}{event.direction ? ` · ${event.direction}` : ''} · suporte heurístico {Math.round(event.confidence * 100)}%</title>
                </rect>
              ) : (
                <circle cx={center} cy={lane} r={2 + event.confidence * 2} fill={color}>
                  <title>{event.type}{event.direction ? ` · ${event.direction}` : ''} · suporte heurístico {Math.round(event.confidence * 100)}%</title>
                </circle>
              )}
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-x-2 gap-y-1 text-[9px] text-muted">
        <span style={{ color: '#9ba8bd' }}>│ compassos</span>
        <span style={{ color: EVENT_COLORS.onset }}>│ ataques por banda espectral</span>
        <span style={{ color: EVENT_COLORS.impact }}>● acento grave</span>
        <span style={{ color: EVENT_COLORS.growth }}>▬ crescimento</span>
        <span style={{ color: EVENT_COLORS.pause }}>▬ pausa</span>
        <span style={{ color: EVENT_COLORS.drop }}>● drop</span>
        <span style={{ color: EVENT_COLORS['rhythm-change'] }}>● mudança de ritmo</span>
      </div>
      <p className="mt-1 text-[9px] text-faint">
        Energia normalizada e eventos locais; suporte é heurístico, não probabilidade. A análise não separa instrumentos nem detecta vocal.
      </p>
    </div>
  );
}
