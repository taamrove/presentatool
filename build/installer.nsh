; Custom NSIS hooks for the Presentatool installer.
;
; The headline problem: electron-updater calls quitAndInstall, which calls
; app.quit() and ~1 second later launches this installer. If the previous
; Electron process tree (main + GPU + renderer + utility, all named
; Presentatool.exe in Task Manager) hasn't fully exited, the installer can't
; overwrite Presentatool.exe and shows:
;
;     "Presentatool cannot be closed. Please close it manually and
;      click Retry to continue."
;
; The "Retry" loop never works on its own because nothing is actually
; clearing the lock. We fix it by force-killing the entire Presentatool
; process tree before the file overwrite begins. The main process should
; already be gone (we have a 800ms force-exit in src/main/index.ts) but
; this catches any orphaned helpers.

!macro customInit
  ; Runs early in the installer, before file-copy begins. We use taskkill
  ; from System32 (full path) because the user's PATH might be exotic.
  ; /F = force, /T = whole process tree. Errors are swallowed so a clean
  ; install with no running process doesn't fail.
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM Presentatool.exe /T'
  ; Tiny pause so Windows can release the file handles before we copy over them.
  Sleep 500
!macroend

!macro customUnInit
  ; Same trick for uninstall — if you hit "Uninstall" while Presentatool is
  ; still running (or has lingering helpers), the same lock prevents it.
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM Presentatool.exe /T'
  Sleep 500
!macroend
