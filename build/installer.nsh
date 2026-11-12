; Crux Windows installer additions (electron-builder include, 2026-11-12).

!macro customInstall
  ; "Uninstall Crux" next to Crux in the Start Menu, as well as in Windows Apps.
  CreateShortCut "$SMPROGRAMS\Uninstall Crux.lnk" "$INSTDIR\Uninstall Crux.exe"
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\Uninstall Crux.lnk"
  ; An update runs the old uninstaller too: never touch the student's data then.
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete your Crux sessions, notes and settings on this computer?$\r$\n$\r$\nChoose No to keep them for when you install Crux again. Files downloaded from the Hub stay in Documents\Crux." /SD IDNO IDNO crux_keep_data
      RMDir /r "$APPDATA\Crux"
    crux_keep_data:
  ${endIf}
!macroend
