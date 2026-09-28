; Whiparc CLI installer (NSIS).
;
; Per-user install — no admin rights required. Places whiparc.exe under
; %LocalAppData%\Programs\Whiparc\bin and adds that directory to the
; current user's PATH (registry + a WM_SETTINGCHANGE broadcast so newly
; opened terminals pick it up immediately, no logoff/reboot needed).
;
; Build (from the repo root, with the target binary already built as
; whiparc-windows-amd64.exe next to this script or passed via /DSOURCE_BINARY):
;   makensis /DVERSION=1.2.3 /DSOURCE_BINARY=..\..\whiparc-windows-amd64.exe installers\windows\whiparc.nsi
;
; Produces whiparc-setup-windows-amd64.exe in the current directory.

Unicode true

!ifndef VERSION
  !define VERSION "0.0.0-dev"
!endif
!ifndef SOURCE_BINARY
  !define SOURCE_BINARY "whiparc-windows-amd64.exe"
!endif

!define APP_NAME "Whiparc"
!define APP_EXE "whiparc.exe"
!define INSTALL_DIR "$LOCALAPPDATA\Programs\Whiparc\bin"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Whiparc"
; HWND_BROADCAST/WM_SETTINGCHANGE come from NSIS's own Include/WinMessages.nsh,
; pulled in transitively below by MUI2.nsh — do NOT !define them here too:
; WinMessages.nsh defines them unconditionally (no !ifndef guard of its own),
; so a duplicate !define here is a hard "already defined!" compile error.

Name "${APP_NAME}"
OutFile "whiparc-setup-windows-amd64.exe"
InstallDir "${INSTALL_DIR}"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUninstDetails show

!include "MUI2.nsh"
!include "LogicLib.nsh"

!define MUI_ABORTWARNING
; Brand assets live next to this script (${__FILEDIR__} keeps the build working
; no matter which directory makensis is invoked from).
!define MUI_ICON "${__FILEDIR__}\whiparc.ico"
!define MUI_UNICON "${__FILEDIR__}\whiparc.ico"
!define MUI_WELCOMEFINISHPAGE_BITMAP "${__FILEDIR__}\welcome.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${__FILEDIR__}\welcome.bmp"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_PARAMETERS "--version"
!define MUI_FINISHPAGE_RUN_NOTCHECKED
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

VIProductVersion "0.0.0.0"
VIAddVersionKey "ProductName" "${APP_NAME} CLI"
VIAddVersionKey "FileDescription" "${APP_NAME} CLI installer"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Whiparc"

; ---------------------------------------------------------------------------
; StrStr: classic public-domain NSIS substring-search recipe. Used so the
; installer/uninstaller only ever add/remove our own directory in the User
; PATH, never touching anything else a user or another installer put there.
; Input: top of stack = string, next = substring. Output: the tail of the
; string starting at the match, or "" if not found. Instantiated as both
; StrStr (installer) and un.StrStr (uninstaller) by the macro below — do not
; also hand-write a standalone `Function StrStr`, the "" instantiation
; already produces exactly that and NSIS errors on the duplicate definition.
; ---------------------------------------------------------------------------
!macro StrStr un
Function ${un}StrStr
  Exch $R1
  Exch
  Exch $R2
  Push $R3
  Push $R4
  Push $R5
  StrLen $R3 $R1
  StrCpy $R4 0
  loop_${un}:
    StrCpy $R5 $R2 $R3 $R4
    StrCmp $R5 $R1 done_${un}
    StrCmp $R5 "" notfound_${un}
    IntOp $R4 $R4 + 1
    Goto loop_${un}
  notfound_${un}:
    StrCpy $R2 ""
    Goto end_${un}
  done_${un}:
    StrCpy $R2 $R2 "" $R4
  end_${un}:
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R1
  Exch $R2
FunctionEnd
!macroend
!insertmacro StrStr ""
!insertmacro StrStr "un."

; ---------------------------------------------------------------------------
; AddToUserPath: appends $INSTDIR to HKCU\Environment\Path if it isn't
; already present (as a whole entry, not just a substring — checked with
; leading/trailing ";" sentinels), then broadcasts WM_SETTINGCHANGE so
; Explorer and newly-launched processes (new terminal windows included)
; re-read the environment without requiring a logoff.
; ---------------------------------------------------------------------------
Function AddToUserPath
  ReadRegStr $0 HKCU "Environment" "Path"
  StrCpy $1 ";$0;"
  Push $1
  Push ";$INSTDIR;"
  Call StrStr
  Pop $2
  StrCmp $2 "" 0 AlreadyPresent
    StrCmp $0 "" FirstEntry
      WriteRegExpandStr HKCU "Environment" "Path" "$0;$INSTDIR"
      Goto Done
    FirstEntry:
      WriteRegExpandStr HKCU "Environment" "Path" "$INSTDIR"
    Done:
      SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
  AlreadyPresent:
FunctionEnd

Function un.RemoveFromUserPath
  ReadRegStr $0 HKCU "Environment" "Path"
  StrCpy $1 ";$0;"
  StrCpy $2 ";$INSTDIR;"
  Push $1
  Push $2
  Call un.StrStr
  Pop $3 ; "" if not found, else the tail of $1 starting at the match
  StrCmp $3 "" NotFound
    ; Rebuild as head + one separating ";" + tail-after-match, so removing
    ; our entry never leaves a double ";" or a dangling one behind,
    ; regardless of whether it was first, last, or in the middle.
    StrLen $4 $1
    StrLen $5 $3
    IntOp $6 $4 - $5   ; length of $1 before the match — the "head"
    StrCpy $7 $1 $6    ; head
    StrLen $8 $2
    StrCpy $9 $3 "" $8 ; tail: $3 with the matched ";$INSTDIR;" stripped off the front
    StrCpy $R0 "$7;$9"

    ; Strip the ";" sentinels this function wrapped around $0 back off.
    StrCpy $R1 $R0 1
    StrCmp $R1 ";" 0 +2
      StrCpy $R0 $R0 "" 1
    StrLen $R2 $R0
    IntOp $R2 $R2 - 1
    StrCpy $R1 $R0 1 $R2
    StrCmp $R1 ";" 0 +2
      StrCpy $R0 $R0 $R2

    WriteRegExpandStr HKCU "Environment" "Path" "$R0"
    SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
  NotFound:
FunctionEnd

Section "Whiparc CLI" SecMain
  SetOutPath "$INSTDIR"
  File /oname=${APP_EXE} "${SOURCE_BINARY}"

  WriteUninstaller "$INSTDIR\uninstall.exe"

  CreateDirectory "$SMPROGRAMS\Whiparc"
  CreateShortcut "$SMPROGRAMS\Whiparc\Whiparc CLI.lnk" "$WINDIR\System32\cmd.exe" '/k "$INSTDIR\${APP_EXE}" --help' "$INSTDIR\${APP_EXE}"
  CreateShortcut "$SMPROGRAMS\Whiparc\Uninstall Whiparc.lnk" "$INSTDIR\uninstall.exe"

  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP_NAME} CLI"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "Whiparc"
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1

  Call AddToUserPath
SectionEnd

Section "Uninstall"
  Call un.RemoveFromUserPath

  Delete "$INSTDIR\${APP_EXE}"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  RMDir "$LOCALAPPDATA\Programs\Whiparc"

  Delete "$SMPROGRAMS\Whiparc\Whiparc CLI.lnk"
  Delete "$SMPROGRAMS\Whiparc\Uninstall Whiparc.lnk"
  RMDir "$SMPROGRAMS\Whiparc"

  DeleteRegKey HKCU "${UNINST_KEY}"
SectionEnd
