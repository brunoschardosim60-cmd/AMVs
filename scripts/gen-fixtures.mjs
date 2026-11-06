#!/usr/bin/env node
/**
 * Gera mídia de teste SINTÉTICA (nunca anime ou música real) em fixtures/generated/.
 * Uso: pnpm fixtures   (respeita AMV_FFMPEG se definido)
 *
 * Cada arquivo cobre um caso real que o app precisa aguentar.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'fixtures', 'generated');
const ffmpeg = process.env.AMV_FFMPEG || 'ffmpeg';
mkdirSync(out, { recursive: true });

const fixtures = [
  {
    // MP4 H.264 + AAC 30 fps: caso comum
    file: 'h264_30fps.mp4',
    args: ['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=4',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4',
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-g', '60', '-c:a', 'aac', '-shortest'],
  },
  {
    // MKV HEVC 10-bit 23,976 com duas faixas de áudio (jpn/por) e legenda ASS: típico de anime
    file: 'hevc10_23976.mkv',
    pre: () => {
      const ass = join(out, '_sub.ass');
      const content = `[Script Info]\nScriptType: v4.00+\nPlayResX: 640\nPlayResY: 360\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,24,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.50,0:00:02.00,Default,,0,0,0,,Eu não vou perder!\n`;
      return import('node:fs').then((fs) => fs.writeFileSync(ass, content));
    },
    args: ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24000/1001:duration=3',
      '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=3',
      '-f', 'lavfi', '-i', 'sine=frequency=550:sample_rate=48000:duration=3',
      '-i', join(out, '_sub.ass'),
      '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:s',
      '-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p10le', '-x265-params', 'log-level=error',
      '-c:a', 'libopus', '-b:a', '64k', '-c:s', 'ass',
      '-metadata:s:a:0', 'language=jpn', '-metadata:s:a:1', 'language=por', '-metadata:s:s:0', 'language=por'],
  },
  {
    // VFR: 1 s a 30 fps, depois 2 s a 10 fps
    file: 'vfr.mp4',
    args: ['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30:duration=3',
      '-vf', "select='lt(t\\,1)+not(mod(n\\,3))',setpts='if(lt(N\\,30)\\,N/30\\,1+(N-30)/10)/TB'",
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-fps_mode', 'passthrough', '-video_track_timescale', '30000'],
  },
  {
    // WEBM VP9 + Opus
    file: 'vp9.webm',
    args: ['-f', 'lavfi', '-i', 'testsrc2=size=480x270:rate=25:duration=2',
      '-f', 'lavfi', '-i', 'sine=frequency=660:duration=2',
      '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '300k', '-c:a', 'libopus', '-shortest'],
  },
  {
    // MOV ProRes sem áudio
    file: 'prores.mov',
    args: ['-f', 'lavfi', '-i', 'smptebars=size=320x180:rate=24:duration=1', '-c:v', 'prores_ks', '-profile:v', '0'],
  },
  {
    // Cliques a 120 BPM (um a cada 0,5 s) por 8 s — para waveform e detecção de batidas
    file: 'click_120bpm.wav',
    args: ['-f', 'lavfi', '-i', "aevalsrc='if(lt(mod(t\\,0.5)\\,0.02)\\,0.9*sin(2*PI*1000*t)\\,0)':s=44100:d=8", '-c:a', 'pcm_s16le'],
  },
  {
    // MP3 com capa embutida (stream de vídeo attached_pic) — precisa ser tratado como ÁUDIO
    file: 'musica_capa.mp3',
    pre: () =>
      new Promise((resolve, reject) => {
        const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=purple:size=300x300', '-frames:v', '1', join(out, '_capa.png')]);
        r.status === 0 ? resolve() : reject(new Error(String(r.stderr)));
      }),
    args: ['-f', 'lavfi', '-i', 'sine=frequency=220:duration=5', '-i', join(out, '_capa.png'),
      '-map', '0:a', '-map', '1:v', '-c:a', 'libmp3lame', '-b:a', '128k', '-c:v', 'mjpeg',
      '-disposition:v', 'attached_pic', '-id3v2_version', '3',
      '-metadata', 'title=Faixa de Teste', '-metadata', 'artist=AMV Studio', '-metadata', 'genre=Teste'],
  },
  {
    file: 'tom.flac',
    args: ['-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=3', '-c:a', 'flac'],
  },
  { file: 'imagem.png', args: ['-f', 'lavfi', '-i', 'testsrc2=size=800x600', '-frames:v', '1'] },
  { file: 'imagem.jpg', args: ['-f', 'lavfi', '-i', 'testsrc2=size=1024x768', '-frames:v', '1', '-q:v', '4'] },
];

let failed = 0;
for (const f of fixtures) {
  const target = join(out, f.file);
  if (existsSync(target) && statSync(target).size > 0 && !process.argv.includes('--force')) {
    console.log(`= ${f.file}`);
    continue;
  }
  if (f.pre) await f.pre();
  const args = ['-hide_banner', '-loglevel', 'error', '-y', ...f.args, target];
  const r = spawnSync(ffmpeg, args, { encoding: 'utf8' });
  if (r.status !== 0) {
    failed++;
    console.error(`✗ ${f.file}\n${r.stderr}`);
  } else {
    console.log(`✓ ${f.file} (${statSync(target).size} bytes)`);
  }
}
if (failed) process.exit(1);
