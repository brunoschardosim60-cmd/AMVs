import { formatDuration, type Asset } from '@amv/project';
import { AlertTriangle, FolderSearch, RotateCcw, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { bytes, codecLabel, durationPrecise, fpsLabel, kindLabel, language } from '../../format';
import { useApp } from '../../store';
import { Button } from '../../ui/controls';
import type { ProjectSession } from '../../core/session';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr] gap-3 py-1 text-xs">
      <dt className="text-muted">{label}</dt>
      <dd className="tnum min-w-0 break-words text-ink-soft">{children}</dd>
    </div>
  );
}

function Preview({ asset, session }: { asset: Asset; session: ProjectSession }) {
  const platform = useApp((s) => s.platform)!;
  const art = session.assetRuntime(asset.id).artifacts;
  const box = 'aspect-video w-full rounded-md bg-black';

  if (asset.status === 'missing') {
    return <div className={`${box} grid place-items-center text-xs text-muted`}>Arquivo não encontrado</div>;
  }
  if (asset.kind === 'image') {
    return <img src={platform.fileUrl(asset.path)} alt={asset.name} className={`${box} object-contain`} />;
  }
  if (asset.kind === 'audio') {
    const src = art?.audioProxyPath ?? asset.path;
    return (
      <div className="rounded-md bg-base p-3">
        <audio key={src} src={platform.fileUrl(src)} controls className="w-full" preload="metadata" />
      </div>
    );
  }
  if (!art?.proxyPath) {
    return (
      <div className={`${box} relative grid place-items-center overflow-hidden`}>
        {art?.posterPath && <img src={platform.fileUrl(art.posterPath)} alt="" className="absolute inset-0 size-full object-contain opacity-40" />}
        <span className="relative text-xs text-ink-soft">{asset.status === 'error' ? 'Sem proxy para pré-visualizar' : 'Preparando pré-visualização…'}</span>
      </div>
    );
  }
  return (
    <video
      key={art.proxyPath}
      src={platform.fileUrl(art.proxyPath)}
      poster={art.posterPath ? platform.fileUrl(art.posterPath) : undefined}
      controls
      preload="metadata"
      className={box}
    />
  );
}

export function AssetDetail({ asset, session }: { asset: Asset; session: ProjectSession }) {
  const { platform, toast } = useApp();
  const rt = session.assetRuntime(asset.id);
  const p = asset.probe;
  const v = p?.video;

  const locate = async () => {
    const ext = asset.path.split('.').pop() ?? '*';
    const path = await platform!.dialogs.pickFile(`Onde está ${asset.name}?`, [ext, 'mp4', 'mkv', 'mov', 'webm', 'mp3', 'wav', 'flac', 'm4a', 'png', 'jpg']);
    if (!path) return;
    const r = await session.relocate(asset.id, path);
    if (r === 'mismatch') {
      const ok = await platform!.dialogs.confirm(
        'Esse arquivo não é idêntico ao original (o conteúdo é diferente). Os cortes podem ficar fora do lugar se a duração mudou. Usar mesmo assim?',
        'Arquivo diferente',
      );
      if (ok) await session.relocate(asset.id, path, true);
    } else {
      toast({ tone: 'ok', title: `${asset.name} encontrado` });
    }
  };

  return (
    <aside className="flex w-[340px] shrink-0 flex-col overflow-y-auto border-l border-line bg-panel" aria-label="Detalhes da mídia">
      <div className="p-4">
        <Preview asset={asset} session={session} />
        <h2 className="mt-3 text-sm font-semibold break-words">{asset.name}</h2>
        <p className="mt-0.5 text-xs text-muted">
          {kindLabel(asset)}
          {p && asset.kind !== 'image' ? `, ${durationPrecise(p.durationUs)}` : ''}
        </p>

        {asset.status === 'missing' && (
          <div className="mt-3 rounded-md border border-warn/30 bg-warn/10 p-3 text-xs">
            <p className="text-warn">O arquivo não está mais em:</p>
            <p className="mt-1 break-all text-ink-soft">{asset.path}</p>
            <Button size="sm" className="mt-2.5" icon={<FolderSearch size={14} />} onClick={locate}>
              Localizar arquivo
            </Button>
          </div>
        )}

        {asset.status === 'error' && (
          <div className="mt-3 rounded-md border border-danger/30 bg-danger/10 p-3 text-xs">
            <p className="text-danger">Não foi possível preparar esta mídia.</p>
            {asset.error && <p className="mt-1 break-words text-ink-soft">{asset.error}</p>}
            <Button size="sm" className="mt-2.5" icon={<RotateCcw size={14} />} onClick={() => session.retry(asset.id)}>
              Tentar de novo
            </Button>
          </div>
        )}

        {rt.warnings.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {rt.warnings.map((w) => (
              <li key={w} className="flex gap-2 text-xs text-ink-soft">
                <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" />
                {w}
              </li>
            ))}
          </ul>
        )}
      </div>

      {p && (
        <dl className="border-t border-line-soft px-4 py-3">
          {v && asset.kind !== 'audio' && (
            <>
              <Row label="Resolução">
                {v.width}×{v.height}
              </Row>
              {asset.kind === 'video' && (
                <Row label="Quadros/s">
                  {fpsLabel(v.fps)}
                  {v.vfr && ` (variável, média ${fpsLabel(v.avgFps)})`}
                </Row>
              )}
              <Row label="Codec">
                {codecLabel(v.codec)}
                {v.profile ? ` ${v.profile}` : ''}
                {v.bitDepth ? `, ${v.bitDepth}-bit` : ''}
              </Row>
            </>
          )}
          {p.audio.map((a, i) => (
            <Row key={a.index} label={p.audio.length > 1 ? `Áudio ${i + 1}` : 'Áudio'}>
              {codecLabel(a.codec)}, {a.sampleRate ? `${(a.sampleRate / 1000).toLocaleString('pt-BR')} kHz` : '—'}, {a.channels === 1 ? 'mono' : a.channels === 2 ? 'estéreo' : `${a.channels} canais`}
              {p.audio.length > 1 || (a.language && a.language !== 'und') ? `, ${language(a.language)}` : ''}
            </Row>
          ))}
          {p.subtitles.map((s, i) => (
            <Row key={s.index} label={p.subtitles.length > 1 ? `Legenda ${i + 1}` : 'Legenda'}>
              {codecLabel(s.codec)}, {language(s.language)}
              {s.title ? ` (${s.title})` : ''}
            </Row>
          ))}
          {(p.tags.title || p.tags.artist) && asset.kind === 'audio' && (
            <>
              {p.tags.title && <Row label="Título">{p.tags.title}</Row>}
              {p.tags.artist && <Row label="Artista">{p.tags.artist}</Row>}
              {p.tags.genre && <Row label="Gênero">{p.tags.genre}</Row>}
            </>
          )}
          <Row label="Contêiner">{p.container.split(',')[0]}</Row>
          <Row label="Tamanho">{bytes(p.sizeBytes)}</Row>
          {p.bitRate && <Row label="Taxa de bits">{(p.bitRate / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} Mb/s</Row>}
          {asset.kind !== 'image' && <Row label="Duração exata">{formatDuration(p.durationUs)}</Row>}
          <Row label="Arquivo">
            <span className="text-muted" title={asset.path}>
              {asset.path}
            </span>
          </Row>
        </dl>
      )}

      <div className="mt-auto flex gap-2 border-t border-line-soft p-3">
        {asset.status !== 'missing' && (
          <Button size="sm" variant="ghost" icon={<FolderSearch size={14} />} onClick={locate}>
            Trocar arquivo
          </Button>
        )}
        <Button size="sm" variant="danger" className="ml-auto" icon={<Trash2 size={14} />} onClick={() => session.removeAsset(asset.id)}>
          Remover do projeto
        </Button>
      </div>
    </aside>
  );
}
