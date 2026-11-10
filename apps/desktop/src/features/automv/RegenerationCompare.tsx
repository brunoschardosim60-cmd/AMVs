import { formatTimecode, type Project } from '@amv/project';
import { useEffect, useRef } from 'react';
import type { ProjectSession } from '../../core/session';
import { createPlayer } from '../editor/Preview';

function ComparisonCanvas({
  session,
  project,
  timeUs,
  title,
}: {
  session: ProjectSession;
  project: Project;
  timeUs: number;
  title: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const player = createPlayer(session, project);
    player.attach(canvas.current!);
    player.seek(timeUs);
    return () => {
      player.pause();
      player.detach();
    };
  }, [project, session, timeUs]);

  return (
    <figure className="min-w-0">
      <figcaption className="mb-1.5 flex items-center justify-between text-xs font-medium text-ink-soft">
        <span>{title}</span>
        <span className="tnum text-2xs text-muted">{formatTimecode(timeUs, project.settings.fps)}</span>
      </figcaption>
      <canvas ref={canvas} className="aspect-video w-full rounded border border-line bg-black" aria-label={`Preview ${title}`} />
    </figure>
  );
}

export function RegenerationCompare({
  session,
  before,
  after,
  timeUs,
}: {
  session: ProjectSession;
  before: Project;
  after: Project;
  timeUs: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-3" aria-label="Comparação antes e depois">
      <ComparisonCanvas session={session} project={before} timeUs={timeUs} title="A · Atual" />
      <ComparisonCanvas session={session} project={after} timeUs={timeUs} title="B · Alternativa" />
    </div>
  );
}
