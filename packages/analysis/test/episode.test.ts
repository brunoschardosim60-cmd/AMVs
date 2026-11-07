import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { probeFile } from '@amv/media';
import { NodeRunner } from '@amv/media/src/node';
import { analyzeEpisodeFile, analyzeMusicFile, filterPath, frameStats, decodeSubtitleBytes, detectFormat, impactScore, parseAss, parseLrc, parseSrt, parseVtt, toSrt } from '../src/index.js';

const runner = new NodeRunner();
let dir: string;

async function ff(args: string[]) {
  const r = await runner.run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  if (r.code !== 0) throw new Error(r.stderr);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'amv-analysis-'));
  // "episódio": 4 s parado (azul) | 4 s de ação (testsrc2 se mexendo) | 4 s parado (cinza)
  // áudio: silêncio | "fala" (ruído na faixa de voz modulado) em 5–7 s | "grito" alto em 9–10 s
  writeFileSync(join(dir, 'sub.srt'), '1\n00:00:05,000 --> 00:00:07,000\nEu não vou desistir!\n\n2\n00:00:09,000 --> 00:00:10,000\nAAAAH!\n');
  await ff([
    '-f', 'lavfi', '-i', 'color=c=0x2040a0:s=320x180:r=24:d=4',
    '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=24:d=4',
    '-f', 'lavfi', '-i', 'color=c=gray:s=320x180:r=24:d=4',
    '-f', 'lavfi', '-i', "aevalsrc='0.4*(between(t,5,7)*(0.6+0.4*sin(2*PI*4*t))*sin(2*PI*700*t)*sin(2*PI*1300*t))+0.95*between(t,9,10)*sin(2*PI*900*t)*sin(2*PI*2100*t)':s=48000:d=12",
    '-i', join(dir, 'sub.srt'),
    '-filter_complex', '[0][1][2]concat=n=3:v=1:a=0[v]',
    '-map', '[v]', '-map', '3:a', '-map', '4:s',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-c:s', 'srt',
    '-metadata:s:s:0', 'language=por',
    join(dir, 'ep.mkv'),
  ]);
  // mesma coisa sem legenda (detecção por áudio)
  await ff(['-i', join(dir, 'ep.mkv'), '-map', '0:v', '-map', '0:a', '-c', 'copy', join(dir, 'ep-sem-legenda.mkv')]);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('episódio', () => {
  it('valores por quadro via arquivo temporário: mesmo resultado, caminho com espaço, acento, vírgula, colchetes e apóstrofo', async () => {
    const odd = join(dir, "pasta d'água, teste [1]"); // no Windows o dois-pontos é o do disco (C:)
    mkdirSync(odd, { recursive: true });
    const file = join(odd, 'quadros.txt');
    const fr: number[] = [];
    const viaFile = await frameStats(runner, join(dir, 'ep.mkv'), 12, undefined, (f) => fr.push(f), {
      path: file,
      read: async (p) => readFileSync(p),
      remove: async (p) => unlinkSync(p),
    });
    const viaStdout = await frameStats(runner, join(dir, 'ep.mkv'), 12);
    expect(viaFile.length).toBeGreaterThan(100);
    expect(viaFile).toEqual(viaStdout);
    expect(viaFile.some((f) => f.ydif > 0) && viaFile.some((f) => f.yavg > 0) && viaFile.some((f) => f.scene > 0.3)).toBe(true);
    expect(existsSync(file)).toBe(false);
    expect(fr.length).toBeGreaterThan(0);
    expect(filterPath('C:\\Users\\Bruno\\cache\\q.txt')).toBe('C\\\\:/Users/Bruno/cache/q.txt');
  });


  it('acha os 2 cortes, a ação no meio e as falas pela legenda', async () => {
    const { probe } = await probeFile(runner, join(dir, 'ep.mkv'));
    const fr: number[] = [];
    const a = await analyzeEpisodeFile(runner, join(dir, 'ep.mkv'), join(dir, 'ep.mkv'), probe, (f) => fr.push(f));
    expect(a.shots.length).toBe(3);
    expect(Math.abs(a.shots[1]!.startS - 4)).toBeLessThan(0.1);
    expect(Math.abs(a.shots[2]!.startS - 8)).toBeLessThan(0.1);
    expect(a.shots[1]!.motion).toBeGreaterThan(a.shots[0]!.motion + 0.3);
    expect(a.shots[1]!.tags).toContain('ação');
    expect(a.subtitles.map((c) => c.text)).toEqual(['Eu não vou desistir!', 'AAAAH!']);
    expect(a.speech).toHaveLength(2);
    expect(a.speech[1]!.kind).toBe('grito');
    expect(a.speech[0]!.impact).toBeGreaterThan(0.5);
    expect(a.shots[2]!.tags).toContain('grito');
    expect(a.shots[2]!.line).toBe('AAAAH!');
    expect(fr.at(-1)).toBe(1);
  });

  it('sem legenda: falas e grito pelo áudio', async () => {
    const path = join(dir, 'ep-sem-legenda.mkv');
    const { probe } = await probeFile(runner, path);
    const a = await analyzeEpisodeFile(runner, path, path, probe, () => undefined);
    expect(a.subtitles).toEqual([]);
    const fala = a.speech.find((s) => s.startS > 4.5 && s.endS < 7.5);
    const grito = a.speech.find((s) => s.startS > 8.5 && s.endS < 10.5);
    expect(fala).toBeDefined();
    expect(grito?.kind).toBe('grito');
    expect(a.speech.every((s) => s.startS > 4.5)).toBe(true); // nada no silêncio
  });

  it('música de arquivo', async () => {
    await ff(['-f', 'lavfi', '-i', "aevalsrc='if(lt(mod(t\\,0.5)\\,0.03)\\,0.9*sin(2*PI*80*t)\\,0)+0.05*sin(2*PI*440*t)':s=44100:d=20", join(dir, 'm.wav')]);
    const a = await analyzeMusicFile(runner, join(dir, 'm.wav'), 20, () => undefined);
    expect(Math.abs(a.bpm - 120)).toBeLessThan(2);
  });
});

describe('legendas', () => {
  it('SRT, VTT, ASS (ignora placas), LRC e volta para SRT', () => {
    const srt = '1\r\n00:00:01,500 --> 00:00:03,000\r\n<i>Olá</i>\r\nmundo\r\n\r\n2\r\n00:01:00,000 --> 00:01:02,250\r\nTchau!\r\n';
    expect(parseSrt(srt)).toEqual([
      { startS: 1.5, endS: 3, text: 'Olá\nmundo' },
      { startS: 60, endS: 62.25, text: 'Tchau!' },
    ]);
    expect(parseVtt('WEBVTT\n\n00:01.000 --> 00:02.500\nOi\n')).toEqual([{ startS: 1, endS: 2.5, text: 'Oi' }]);
    const ass = `[Script Info]\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:02.00,0:00:04.50,Default,,0,0,0,,{\\i1}Eu sou o mais forte,\\Nlembre disso\nDialogue: 0,0:00:03.00,0:00:05.00,Sign,,0,0,0,,PLACA\n`;
    expect(parseAss(ass)).toEqual([{ startS: 2, endS: 4.5, text: 'Eu sou o mais forte,\nlembre disso' }]);
    expect(parseLrc('[00:12.00]Primeira\n[00:15.50]Segunda', 20)).toEqual([
      { startS: 12, endS: 15.5, text: 'Primeira' },
      { startS: 15.5, endS: 20, text: 'Segunda' },
    ]);
    expect(detectFormat('x.txt', '[00:01.00]a')).toBe('lrc');
    expect(parseSrt(toSrt(parseSrt(srt)))).toEqual(parseSrt(srt));
  });

  it('decodifica UTF-8 com BOM e Windows-1252', () => {
    expect(decodeSubtitleBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x6f, 0x6c, 0xc3, 0xa1]))).toBe('olá');
    expect(decodeSubtitleBytes(new Uint8Array([0x6f, 0x6c, 0xe1]))).toBe('olá');
  });

  it('frase marcante', () => {
    expect(impactScore('Eu vou vencer!')).toBeGreaterThan(0.7);
    expect(impactScore('Então, ontem eu fui ao mercado comprar pão e leite para o café da manhã de amanhã cedo')).toBeLessThan(0.2);
  });
});
