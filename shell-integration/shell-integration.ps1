# ------------------------------------------------------------------------------
#   Copyright (c) Microsoft Corporation. All rights reserved.
#   Licensed under the MIT License.
# ------------------------------------------------------------------------------

# Prevent installing more than once per session
if ((Test-Path variable:global:__LumineState) -and $null -ne $Global:__LumineState.OriginalPrompt) {
	return;
}

# Disable shell integration when the language mode is restricted
if ($ExecutionContext.SessionState.LanguageMode -ne "FullLanguage") {
	return;
}

$Global:__LumineState = @{
	OriginalPrompt = $function:Prompt
	LastHistoryId = -1
	IsInExecution = $false
	EnvVarsToReport = @()
	Nonce = $null
	IsStable = $null
	IsA11yMode = $null
	IsWindows10 = $false
}

# Store the nonce in a regular variable and unset the environment variable. It's by design that
# anything that can execute PowerShell code can read the nonce, as it's basically impossible to hide
# in PowerShell. The most important thing is getting it out of the environment.
$Global:__LumineState.Nonce = $env:LUMINE_TERMINAL_NONCE
$env:LUMINE_TERMINAL_NONCE = $null

$Global:__LumineState.IsStable = $env:LUMINE_TERMINAL_STABLE
$env:LUMINE_TERMINAL_STABLE = $null

$Global:__LumineState.IsA11yMode = $env:LUMINE_TERMINAL_A11Y_MODE
$env:LUMINE_TERMINAL_A11Y_MODE = $null

$__lumine_shell_env_reporting = $env:LUMINE_TERMINAL_SHELL_ENV_REPORTING
$env:LUMINE_TERMINAL_SHELL_ENV_REPORTING = $null
if ($__lumine_shell_env_reporting) {
	$Global:__LumineState.EnvVarsToReport = $__lumine_shell_env_reporting.Split(',')
}
Remove-Variable -Name __lumine_shell_env_reporting -ErrorAction SilentlyContinue

$osVersion = [System.Environment]::OSVersion.Version
$Global:__LumineState.IsWindows10 = $IsWindows -and $osVersion.Major -eq 10 -and $osVersion.Minor -eq 0 -and $osVersion.Build -lt 22000
Remove-Variable -Name osVersion -ErrorAction SilentlyContinue

if ($env:LUMINE_TERMINAL_ENV_REPLACE) {
	$Split = $env:LUMINE_TERMINAL_ENV_REPLACE.Split(":")
	foreach ($Item in $Split) {
		$Inner = $Item.Split('=', 2)
		[Environment]::SetEnvironmentVariable($Inner[0], $Inner[1].Replace('\x3a', ':'))
	}
	$env:LUMINE_TERMINAL_ENV_REPLACE = $null
}
if ($env:LUMINE_TERMINAL_ENV_PREPEND) {
	$Split = $env:LUMINE_TERMINAL_ENV_PREPEND.Split(":")
	foreach ($Item in $Split) {
		$Inner = $Item.Split('=', 2)
		[Environment]::SetEnvironmentVariable($Inner[0], $Inner[1].Replace('\x3a', ':') + [Environment]::GetEnvironmentVariable($Inner[0]))
	}
	$env:LUMINE_TERMINAL_ENV_PREPEND = $null
}
if ($env:LUMINE_TERMINAL_ENV_APPEND) {
	$Split = $env:LUMINE_TERMINAL_ENV_APPEND.Split(":")
	foreach ($Item in $Split) {
		$Inner = $Item.Split('=', 2)
		[Environment]::SetEnvironmentVariable($Inner[0], [Environment]::GetEnvironmentVariable($Inner[0]) + $Inner[1].Replace('\x3a', ':'))
	}
	$env:LUMINE_TERMINAL_ENV_APPEND = $null
}

# Register Python shell activate hooks
# Prevent multiple activation with guard
if (-not $env:LUMINE_TERMINAL_PYTHON_AUTOACTIVATE_GUARD) {
	$env:LUMINE_TERMINAL_PYTHON_AUTOACTIVATE_GUARD = '1'
	if ($env:LUMINE_TERMINAL_PYTHON_PWSH_ACTIVATE -and $env:TERM_PROGRAM -eq 'lumine') {
		$activateScript = $env:LUMINE_TERMINAL_PYTHON_PWSH_ACTIVATE

		try {
			Invoke-Expression $activateScript
			$Global:__LumineState.OriginalPrompt = $function:Prompt
		}
		catch {
			$activationError = $_
			Write-Host "`e[0m`e[7m * `e[0;103m Lumine Python powershell activation failed with exit code $($activationError.Exception.Message) `e[0m"
		}
	}
	# Remove any leftover Python activation env vars.
	Get-ChildItem Env:LUMINE_TERMINAL_PYTHON_*_ACTIVATE | Remove-Item -ErrorAction SilentlyContinue
}

function Global:__Lumine-Escape-Value([string]$value) {
	# NOTE: In PowerShell v6.1+, this can be written `$value -replace '…', { … }` instead of `[regex]::Replace`.
	# Replace any non-alphanumeric characters.
	[regex]::Replace($value, "[$([char]0x00)-$([char]0x1f)\\\n;]", { param($match)
			# Encode the (ascii) matches as `\x<hex>`
			-Join (
				[System.Text.Encoding]::UTF8.GetBytes($match.Value) | ForEach-Object { '\x{0:x2}' -f $_ }
			)
		})
}

function Global:Prompt() {
	$FakeCode = [int]!$global:?
	# NOTE: We disable strict mode for the scope of this function because it unhelpfully throws an
	# error when $LastHistoryEntry is null, and is not otherwise useful.
	Set-StrictMode -Off
	$LastHistoryEntry = Get-History -Count 1
	$Result = ""
	# Skip finishing the command if the first command has not yet started or an execution has not
	# yet begun
	if ($Global:__LumineState.LastHistoryId -ne -1 -and ($Global:__LumineState.HasPSReadLine -eq $false -or $Global:__LumineState.IsInExecution -eq $true)) {
		$Global:__LumineState.IsInExecution = $false
		if ($LastHistoryEntry.Id -eq $Global:__LumineState.LastHistoryId) {
			# Don't provide a command line or exit code if there was no history entry (eg. ctrl+c, enter on no command)
			$Result += "$([char]0x1b)]633;D`a"
		}
		else {
			# Command finished exit code
			# OSC 633 ; D [; <ExitCode>] ST
			$Result += "$([char]0x1b)]633;D;$FakeCode`a"
		}
	}
	# Prompt started
	# OSC 633 ; A ST
	$Result += "$([char]0x1b)]633;A`a"
	# Current working directory
	# OSC 633 ; <Property>=<Value> ST
	$Result += if ($pwd.Provider.Name -eq 'FileSystem') { "$([char]0x1b)]633;P;Cwd=$(__Lumine-Escape-Value $pwd.ProviderPath)`a" }

	# Send current environment variables as JSON
	# OSC 633 ; EnvJson ; <Environment> ; <Nonce>
	if ($Global:__LumineState.EnvVarsToReport.Count -gt 0) {
		$envMap = @{}
        foreach ($varName in $Global:__LumineState.EnvVarsToReport) {
            if (Test-Path "env:$varName") {
                $envMap[$varName] = (Get-Item "env:$varName").Value
            }
        }
        $envJson = $envMap | ConvertTo-Json -Compress
        $Result += "$([char]0x1b)]633;EnvJson;$(__Lumine-Escape-Value $envJson);$($Global:__LumineState.Nonce)`a"
	}

	# Before running the original prompt, put $? back to what it was:
	if ($FakeCode -ne 0) {
		Write-Error "failure" -ea ignore
	}
	# Run the original prompt
	$OriginalPrompt += $Global:__LumineState.OriginalPrompt.Invoke()
	$Result += $OriginalPrompt

	# Prompt
	# OSC 633 ; <Property>=<Value> ST
	if ($Global:__LumineState.IsStable -eq "0") {
		$Result += "$([char]0x1b)]633;P;Prompt=$(__Lumine-Escape-Value $OriginalPrompt)`a"
	}

	# Write command started
	$Result += "$([char]0x1b)]633;B`a"
	$Global:__LumineState.LastHistoryId = $LastHistoryEntry.Id
	return $Result
}

# Report prompt type
if ($env:STARSHIP_SESSION_KEY) {
	[Console]::Write("$([char]0x1b)]633;P;PromptType=starship`a")
}
elseif ($env:POSH_SESSION_ID) {
	[Console]::Write("$([char]0x1b)]633;P;PromptType=oh-my-posh`a")
}
elseif ((Test-Path variable:global:GitPromptSettings) -and $Global:GitPromptSettings) {
	[Console]::Write("$([char]0x1b)]633;P;PromptType=posh-git`a")
}

if ($Global:__LumineState.IsA11yMode -eq "1") {
	# Check if the loaded PSReadLine already supports EnableScreenReaderMode
	$hasScreenReaderParam = (Get-Module -Name PSReadLine) -and (Get-Command Set-PSReadLineOption).Parameters.ContainsKey('EnableScreenReaderMode')

	if (-not $hasScreenReaderParam -and $PSVersionTable.PSVersion -ge "7.0") {
		# The loaded PSReadLine lacks EnableScreenReaderMode (only available in 2.4.4-beta4+).
		# PowerShell 7.0+ skips autoloading PSReadLine when the OS reports a screen reader active.
		# When only VS Code's accessibility mode is enabled (no OS screen reader),
		# it's still loaded and must be removed to load our bundled copy.
		# Skip this on Windows PowerShell 5.1 where removing the built-in PSReadLine 2.0.0
		# and replacing it can cause input handling issues (e.g. repeated Enter key presses).
		if (Get-Module -Name PSReadLine) {
			Remove-Module PSReadLine -Force
		}

		# Import VS Code's bundled PSReadLine 2.4.3 which has EnableScreenReaderMode
		$specialPsrlPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'psreadline'
		if (Test-Path $specialPsrlPath) {
			Import-Module $specialPsrlPath
		}

		$hasScreenReaderParam = (Get-Module -Name PSReadLine) -and (Get-Command Set-PSReadLineOption).Parameters.ContainsKey('EnableScreenReaderMode')
	}

	if ($hasScreenReaderParam) {
		Set-PSReadLineOption -EnableScreenReaderMode
	}
}

# Only send the command executed sequence when PSReadLine is loaded, if not shell integration should
# still work thanks to the command line sequence
$Global:__LumineState.HasPSReadLine = $false
if (Get-Module -Name PSReadLine) {
	$Global:__LumineState.HasPSReadLine = $true
	[Console]::Write("$([char]0x1b)]633;P;HasRichCommandDetection=True`a")

	$Global:__LumineState.OriginalPSConsoleHostReadLine = $function:PSConsoleHostReadLine
	function Global:PSConsoleHostReadLine {
		$CommandLine = $Global:__LumineState.OriginalPSConsoleHostReadLine.Invoke()
		$Global:__LumineState.IsInExecution = $true

		# Command line
		# OSC 633 ; E [; <CommandLine> [; <Nonce>]] ST
		$Result = "$([char]0x1b)]633;E;"
		$Result += $(__Lumine-Escape-Value $CommandLine)
		# Command text is trusted only when it carries the per-session nonce.
		$Result += ";$($Global:__LumineState.Nonce)"
		$Result += "`a"

		# Command executed
		# OSC 633 ; C ST
		$Result += "$([char]0x1b)]633;C`a"

		# Write command executed sequence directly to Console to avoid the new line from Write-Host
		[Console]::Write($Result)

		$CommandLine
	}

	# Set ContinuationPrompt property
	$Global:__LumineState.ContinuationPrompt = (Get-PSReadLineOption).ContinuationPrompt
	if ($Global:__LumineState.ContinuationPrompt) {
		[Console]::Write("$([char]0x1b)]633;P;ContinuationPrompt=$(__Lumine-Escape-Value $Global:__LumineState.ContinuationPrompt)`a")
	}
}

# Set IsWindows property
if ($PSVersionTable.PSVersion -lt "6.0") {
	# Windows PowerShell is only available on Windows
	[Console]::Write("$([char]0x1b)]633;P;IsWindows=$true`a")
}
else {
	[Console]::Write("$([char]0x1b)]633;P;IsWindows=$IsWindows`a")
}

if ($Global:__LumineState.HasPSReadLine) {
	# Prevent AI-executed commands from polluting shell history
	if ($env:LUMINE_TERMINAL_PREVENT_SHELL_HISTORY -eq "1") {
		Set-PSReadLineOption -AddToHistoryHandler {
			param([string]$line)
			return $false
		}
		$env:LUMINE_TERMINAL_PREVENT_SHELL_HISTORY = $null
	}
}
