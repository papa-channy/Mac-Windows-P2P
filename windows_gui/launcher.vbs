' launcher.vbs — invisible PowerShell launcher for Explorer context menu hooks.
'
' Why: wscript.exe runs without a console window, so pwsh.exe spawned from
' here doesn't flash a terminal at the user. The .ps1 script can still show
' WPF dialogs since it owns its own UI thread.
'
' Usage:
'   wscript.exe "launcher.vbs" "<script-name-in-same-dir>" [arg1] [arg2] ...
'
' All args after the script name are passed through to the .ps1 verbatim.

If WScript.Arguments.Count < 1 Then WScript.Quit 64

Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Prefer PowerShell 7 if installed in standard location, else PATH lookup, else fall back.
pwsh = sh.ExpandEnvironmentStrings("%ProgramFiles%\PowerShell\7\pwsh.exe")
If Not fso.FileExists(pwsh) Then pwsh = "pwsh.exe"

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
psScript  = fso.BuildPath(scriptDir, WScript.Arguments(0))

cmdLine = """" & pwsh & """ -NoProfile -ExecutionPolicy Bypass -File """ & psScript & """"
For i = 1 To WScript.Arguments.Count - 1
    cmdLine = cmdLine & " """ & WScript.Arguments(i) & """"
Next

' Run hidden (0), do not wait (False).
sh.Run cmdLine, 0, False
