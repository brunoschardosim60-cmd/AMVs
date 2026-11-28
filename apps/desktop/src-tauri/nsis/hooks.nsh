!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Encerrando processos em segundo plano do AMV Studio..."
  nsExec::ExecToLog 'taskkill /F /IM analyzer.exe /T'
  nsExec::ExecToLog 'taskkill /F /IM amv-studio.exe /T'
  Sleep 350
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Encerrando processos em segundo plano do AMV Studio..."
  nsExec::ExecToLog 'taskkill /F /IM analyzer.exe /T'
  nsExec::ExecToLog 'taskkill /F /IM amv-studio.exe /T'
  Sleep 350
!macroend
