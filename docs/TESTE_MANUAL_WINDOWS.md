# Checklist de Teste Manual — Windows (WebView2)

Execute este roteiro após instalar uma nova versão pelo instalador NSIS (`AMV Studio_x.y.z_x64-setup.exe`).

1. **Instalação única:** confirmar que o app instalou em `%LOCALAPPDATA%\AMV Studio` e substituiu a versão anterior sem criar pasta duplicada em `C:\Program Files\AMV Studio`.
2. **Importação de mídia:** importar 1 música (`.mp3` ou `.wav`) e 1 episódio de anime (`.mp4` ou `.mkv`) e aguardar a análise concluir sem erro.
3. **Preview no WebView2:** dar Play/Pause e arrastar a agulha na timeline verificando sincronia de vídeo e áudio sem travamentos.
4. **Geração automática (Hype / Luta):** gerar um AMV de 30–45 s com falas em `voiceover` e letra da música ativa; confirmar:
   - Cores vivas preservadas nas lutas (sem fundo preto ou vinheta escura indevida);
   - Letra da música e legenda de fala visualmente diferentes (posição, fonte e estilo);
   - Auto-reparo exibido no resumo da revisão sem `14 média` de saltos de luminosidade;
   - Sem repetição excessiva do mesmo trecho de cena.
5. **Tradução rápida:** traduzir legendas/letras para Português e verificar conclusão rápida; repetir a tradução e confirmar retorno instantâneo via cache (`translate-cache.json`).
6. **Auto-sync de legendas:** no painel de Legendas, clicar em **Auto-sync** e verificar o ajuste de deslocamento nas batidas.
7. **Edição direta na timeline:** selecionar um clipe, usar a barra rápida (trocar cena, modificar, cortar, excluir) e testar **Ctrl+Z** / **Ctrl+Y**.
8. **Exportação final:** exportar um trecho curto em MP4 (H.264/AAC) e reproduzir o arquivo exportado no player do Windows.
9. **Atualizador interno:** confirmar que o verificador de atualizações consulta o `latest.json` da release sem erro de rede ou assinatura.
10. **Fechamento limpo:** fechar o aplicativo e confirmar no Gerenciador de Tarefas que nenhum processo `ffmpeg.exe` ou `amv-analyzer` ficou órfão.
