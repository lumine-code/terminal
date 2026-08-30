# ------------------------------------------------------------------------------
#   Copyright (c) Microsoft Corporation. All rights reserved.
#   Licensed under the MIT License.
# ------------------------------------------------------------------------------

# Lumine terminal integration for fish, adapted from Visual Studio Code.

# Don't run in scripts, other terminals, or more than once per session. This
# file is sourced by fish, so returning must never terminate the shell itself.
if not status is-interactive; or not string match --quiet "$TERM_PROGRAM" "lumine"; or set --query LUMINE_TERMINAL_SHELL_INTEGRATION
	return
end

set --global LUMINE_TERMINAL_SHELL_INTEGRATION 1
set --global __lumine_shell_env_reporting $LUMINE_TERMINAL_SHELL_ENV_REPORTING
set -e LUMINE_TERMINAL_SHELL_ENV_REPORTING

# Prevent AI-executed commands from polluting shell history
if test "$LUMINE_TERMINAL_PREVENT_SHELL_HISTORY" = "1"
	set -g fish_private_mode 1
	set -e LUMINE_TERMINAL_PREVENT_SHELL_HISTORY
end

set -g envVarsToReport
if test -n "$__lumine_shell_env_reporting"
	set envVarsToReport (string split "," "$__lumine_shell_env_reporting")
end

# Apply any explicit path prefix (see #99878)
# On fish, '$fish_user_paths' is always prepended to the PATH, for both login and non-login shells, so we need
# to apply the path prefix fix always, not only for login shells (see #232291)
if set -q LUMINE_TERMINAL_PATH_PREFIX
	set -gx PATH "$LUMINE_TERMINAL_PATH_PREFIX$PATH"
end
set -e LUMINE_TERMINAL_PATH_PREFIX

set -g lumine_env_keys
set -g lumine_env_values

# Tracks if the shell has been initialized, this prevents
set -g lumine_initialized 0

set -g __lumine_applied_env_vars 0
function __lumine_apply_env_vars
	if test $__lumine_applied_env_vars -eq 1;
		return
	end
	set -l __lumine_applied_env_vars 1
	# Apply EnvironmentVariableCollections if needed
	if test -n "$LUMINE_TERMINAL_ENV_REPLACE"
		set ITEMS (string split : $LUMINE_TERMINAL_ENV_REPLACE)
		for B in $ITEMS
			set split (string split -m1 = $B)
			set -gx "$split[1]" (echo -e "$split[2]")
		end
		set -e LUMINE_TERMINAL_ENV_REPLACE
	end
	if test -n "$LUMINE_TERMINAL_ENV_PREPEND"
		set ITEMS (string split : $LUMINE_TERMINAL_ENV_PREPEND)
		for B in $ITEMS
			set split (string split -m1 = $B)
			set -gx "$split[1]" (echo -e "$split[2]")"$$split[1]" # avoid -p as it adds a space
		end
		set -e LUMINE_TERMINAL_ENV_PREPEND
	end
	if test -n "$LUMINE_TERMINAL_ENV_APPEND"
		set ITEMS (string split : $LUMINE_TERMINAL_ENV_APPEND)
		for B in $ITEMS
			set split (string split -m1 = $B)
			set -gx "$split[1]" "$$split[1]"(echo -e "$split[2]") # avoid -a as it adds a space
		end
		set -e LUMINE_TERMINAL_ENV_APPEND
	end
end

# Register Python shell activate hooks
# Prevent multiple activation with guard
if not set -q LUMINE_TERMINAL_PYTHON_AUTOACTIVATE_GUARD
	set -gx LUMINE_TERMINAL_PYTHON_AUTOACTIVATE_GUARD 1
	if test -n "$LUMINE_TERMINAL_PYTHON_FISH_ACTIVATE"; and test "$TERM_PROGRAM" = "lumine"
		# Fish does not crash on eval failure, so don't need negation.
		eval $LUMINE_TERMINAL_PYTHON_FISH_ACTIVATE
		set __lumine_activation_status $status

		if test $__lumine_activation_status -ne 0
			builtin printf '\x1b[0m\x1b[7m * \x1b[0;103m Lumine Python fish activation failed with exit code %d \x1b[0m \n' "$__lumine_activation_status"
		end
	end
	# Remove any leftover Python activation env vars.
	for var in (set -n | string match -r '^LUMINE_TERMINAL_PYTHON_.*_ACTIVATE$')
		set -eg $var
	end
end

# Handle the shell integration nonce
if set -q LUMINE_TERMINAL_NONCE
	set --global __lumine_nonce $LUMINE_TERMINAL_NONCE
	set -e LUMINE_TERMINAL_NONCE
end

# Helper function
function __lumine_esc -d "Emit escape sequences for Lumine shell integration"
	builtin printf "\e]633;%s\a" (string join ";" -- $argv)
end

# Sent right before executing an interactive command.
# Marks the beginning of command output.
function __lumine_cmd_executed --on-event fish_preexec
	__lumine_esc E (__lumine_escape_value "$argv") $__lumine_nonce
	__lumine_esc C

	# Creates a marker to indicate a command was run.
	set --global _lumine_has_cmd
end


# Escape a value for use in the 'P' ("Property") or 'E' ("Command Line") sequences.
# Backslashes are doubled and non-alphanumeric characters are hex encoded.
function __lumine_escape_value
	# Escape backslashes and semi-colons
	echo $argv | string replace --all '\\' '\\\\' | string replace --all ';' '\\x3b'
end

# Sent right after an interactive command has finished executing.
# Marks the end of command output.
function __lumine_cmd_finished --on-event fish_postexec
	__lumine_esc D $status
end

# Sent when a command line is cleared or reset, but no command was run.
# Marks the cleared line with neither success nor failure.
function __lumine_cmd_clear --on-event fish_cancel
	if test $lumine_initialized -eq 0;
		return
	end
	__lumine_esc E "" $__lumine_nonce
	__lumine_esc C
	__lumine_esc D
end

# Preserve the user's existing prompt, to wrap in our escape sequences.
function __preserve_fish_prompt --on-event fish_prompt
	if functions --query fish_prompt
		if functions --query __lumine_fish_prompt
			# Erase the fallback so it can be set to the user's prompt
			functions --erase __lumine_fish_prompt
		end
		functions --copy fish_prompt __lumine_fish_prompt
		functions --erase __preserve_fish_prompt
		# Now __lumine_fish_prompt is guaranteed to be defined
		__init_lumine_shell_integration
	else
		if functions --query __lumine_fish_prompt
			functions --erase __preserve_fish_prompt
			__init_lumine_shell_integration
		else
			# There is no fish_prompt set, so stick with the default
			# Now __lumine_fish_prompt is guaranteed to be defined
			function __lumine_fish_prompt
				echo -n (whoami)@(prompt_hostname) (prompt_pwd) '~> '
			end
		end
	end
end

# Sent whenever a new fish prompt is about to be displayed.
# Updates the current working directory.
function __lumine_update_cwd --on-event fish_prompt
	__lumine_esc P Cwd=(__lumine_escape_value "$PWD")

	# If a command marker exists, remove it.
	# Otherwise, the commandline is empty and no command was run.
	if set --query _lumine_has_cmd
		set --erase _lumine_has_cmd
	else
		__lumine_cmd_clear
	end
end

if test -n "$__lumine_shell_env_reporting"
	function __lumine_update_env --on-event fish_prompt
		if test (count $envVarsToReport) -gt 0
			__lumine_esc EnvSingleStart 1

			for key in $envVarsToReport
				if set -q $key
					set -l value $$key
					__lumine_esc EnvSingleEntry $key (__lumine_escape_value "$value")
				end
			end

			__lumine_esc EnvSingleEnd
		end
	end
end

# Sent at the start of the prompt.
# Marks the beginning of the prompt (and, implicitly, a new line).
function __lumine_fish_prompt_start
	# Applying environment variables is deferred to after config.fish has been
	# evaluated
	__lumine_apply_env_vars
	__lumine_esc A
	set -g lumine_initialized 1
end

# Sent at the end of the prompt.
# Marks the beginning of the user's command input.
function __lumine_fish_cmd_start
	__lumine_esc B
end

function __lumine_fish_has_mode_prompt -d "Returns true if fish_mode_prompt is defined and not empty"
	functions fish_mode_prompt | string match -rvq '^ *(#|function |end$|$)'
end

# Preserve and wrap fish_mode_prompt (which appears to the left of the regular
# prompt), but only if it's not defined as an empty function (which is the
# officially documented way to disable that feature).
function __init_lumine_shell_integration
	if __lumine_fish_has_mode_prompt
		functions --copy fish_mode_prompt __lumine_fish_mode_prompt

		function fish_mode_prompt
			__lumine_fish_prompt_start
			__lumine_fish_mode_prompt
		end

		function fish_prompt
			__lumine_fish_prompt
			__lumine_fish_cmd_start
		end
	else
		# No fish_mode_prompt, so put everything in fish_prompt.
		function fish_prompt
			__lumine_fish_prompt_start
			__lumine_fish_prompt
			__lumine_fish_cmd_start
		end
	end
end

# Report prompt type
if set -q POSH_SESSION_ID
	__lumine_esc P PromptType=oh-my-posh
end

# Report this shell supports rich command detection
__lumine_esc P HasRichCommandDetection=True

__preserve_fish_prompt
