; Crux Harness: a Start Menu "Uninstall Crux Harness" entry, and a choice to keep or delete local data on uninstall.
; The data folder stays %APPDATA%\Crux after the rename, so sessions and notes carry over.

!macro customInstall
  Delete "$SMPROGRAMS\Uninstall Crux.lnk"
  CreateShortCut "$SMPROGRAMS\Uninstall Crux Harness.lnk" "$INSTDIR\Uninstall Crux Harness.exe"
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\Uninstall Crux Harness.lnk"
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete your Crux Harness sessions, notes and settings on this computer?$\r$\n$\r$\nChoose No to keep them for when you install Crux Harness again. Files downloaded from the Hub stay in Documents\Crux." /SD IDNO IDNO crux_keep_data
      RMDir /r "$APPDATA\Crux"
    crux_keep_data:
  ${endIf}
!macroend
