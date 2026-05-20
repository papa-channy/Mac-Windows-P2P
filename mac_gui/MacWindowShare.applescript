-- MacWindowShare.app — desktop GUI for Mac-Window_Share
-- Compile: osacompile -o ~/Desktop/Mac-Window_Share.app MacWindowShare.applescript
-- Behavior:
--   1. On launch, try to mount silently (uses keychain).
--   2. Show action menu: Open / Status / Doctor / Unmount / Quit.
--   3. All real work delegated to ~/Library/Application Support/MacWindowShare/mw

property mwCli : (POSIX path of (path to home folder)) & "Library/Application Support/MacWindowShare/mw"

on run
	-- Step 1: ensure mount (mw mount is idempotent and detects either default mp or Finder /Volumes)
	set mountResult to runMw("mount")
	if (mountedNow() is false) then
		display dialog "Mount failed." & return & return & mountResult buttons {"Run Diagnostics", "Quit"} default button "Run Diagnostics" with icon stop
		if button returned of result is "Run Diagnostics" then
			showDoctor()
		end if
		return
	end if

	-- Step 2: action menu (loop until Quit/Close)
	repeat
		set choices to {"Open in Finder", "Show Status", "Run Diagnostics", "Unmount", "Quit"}
		set picked to choose from list choices ¬
			with prompt "Mac-Window_Share" ¬
			default items {"Open in Finder"} ¬
			OK button name "Go" ¬
			cancel button name "Close"
		if picked is false then exit repeat
		set theAction to item 1 of picked

		if theAction is "Open in Finder" then
			runMw("open")
			exit repeat
		else if theAction is "Show Status" then
			set s to runMw("status")
			display dialog s buttons {"OK"} default button "OK" with title "Mac-Window_Share — Status"
		else if theAction is "Run Diagnostics" then
			showDoctor()
		else if theAction is "Unmount" then
			set u to runMw("umount")
			display notification u with title "Mac-Window_Share"
			exit repeat
		else if theAction is "Quit" then
			exit repeat
		end if
	end repeat
end run

on runMw(subcmd)
	try
		return do shell script quoted form of mwCli & " " & subcmd
	on error errMsg number errNum
		return "(error " & errNum & ") " & errMsg
	end try
end runMw

on mountedNow()
	try
		do shell script quoted form of mwCli & " status | /usr/bin/grep -q 'mount:  mounted'"
		return true
	on error
		return false
	end try
end mountedNow

on showDoctor()
	set d to runMw("doctor")
	display dialog d buttons {"OK"} default button "OK" with title "Mac-Window_Share — Doctor"
end showDoctor
