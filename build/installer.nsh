; Optional page, unchecked by default, for associating Markdown extensions.
; The association is written to HKCU, so administrator privileges are not required.

!include nsDialogs.nsh
!include LogicLib.nsh

Var MdAssocCheckbox
Var MdAssocState

!macro customPageAfterChangeDir
  Page custom mdAssocPageCreate mdAssocPageLeave
!macroend

Function mdAssocPageCreate
  !insertmacro MUI_HEADER_TEXT "File association" "Choose whether MD Reader should open Markdown files."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "You can associate Markdown files with MD Reader so they open on double-click. This changes only your user settings."
  Pop $1

  ${NSD_CreateCheckbox} 0 32u 100% 12u "Associate .md, .markdown, .mdown, and .mkd files with MD Reader"
  Pop $MdAssocCheckbox
  ${NSD_SetState} $MdAssocCheckbox ${BST_UNCHECKED}

  nsDialogs::Show
FunctionEnd

Function mdAssocPageLeave
  ${NSD_GetState} $MdAssocCheckbox $MdAssocState
FunctionEnd

!macro RegisterMdExtension EXT
  WriteRegStr HKCU "Software\Classes\${EXT}" "" "MDReader.Document"
!macroend

!macro UnregisterMdExtension EXT
  ReadRegStr $0 HKCU "Software\Classes\${EXT}" ""
  ${If} $0 == "MDReader.Document"
    DeleteRegKey HKCU "Software\Classes\${EXT}"
  ${EndIf}
!macroend

!macro customInstall
  ${If} $MdAssocState == ${BST_CHECKED}
    WriteRegStr HKCU "Software\Classes\MDReader.Document" "" "Markdown document"
    WriteRegStr HKCU "Software\Classes\MDReader.Document\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
    WriteRegStr HKCU "Software\Classes\MDReader.Document\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
    !insertmacro RegisterMdExtension ".md"
    !insertmacro RegisterMdExtension ".markdown"
    !insertmacro RegisterMdExtension ".mdown"
    !insertmacro RegisterMdExtension ".mkd"
    System::Call 'shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${EndIf}
!macroend

!macro customUnInstall
  !insertmacro UnregisterMdExtension ".md"
  !insertmacro UnregisterMdExtension ".markdown"
  !insertmacro UnregisterMdExtension ".mdown"
  !insertmacro UnregisterMdExtension ".mkd"
  DeleteRegKey HKCU "Software\Classes\MDReader.Document"
  System::Call 'shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend
