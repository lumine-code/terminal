# Lumine terminal shell integration for PowerShell.
#
# Source this from your $PROFILE:
#     . /path/to/lumine.ps1
#
# It emits OSC 133 sequences so Lumine can mark each command, decorate its
# prompt by exit status, and navigate between prompts. PowerShell has no
# pre-execution hook, so the "output starts" mark (C) is omitted; the prompt
# and exit-status marks are enough for the command decorations.

if ($env:LUMINE_SHELL_INTEGRATION) { return }
$env:LUMINE_SHELL_INTEGRATION = "1"

# Wrap the existing prompt so we don't lose the user's customizations.
$Global:__LumineOriginalPrompt = $Function:prompt

function Global:prompt {
  $exitCode = if ($LASTEXITCODE -is [int]) { $LASTEXITCODE } elseif ($?) { 0 } else { 1 }
  $esc = [char]27
  $bel = [char]7

  # Report the previous command's result, then mark the start of a new prompt.
  Write-Host -NoNewline "$esc]133;D;$exitCode$bel"
  Write-Host -NoNewline "$esc]133;A$bel"

  $rendered = & $Global:__LumineOriginalPrompt

  # Mark the end of the prompt (where command input begins).
  "$rendered$esc]133;B$bel"
}
