# Lumine terminal shell integration for bash.
#
# Source this from your ~/.bashrc:
#     source /path/to/lumine.bash
#
# It emits OSC 133 sequences so Lumine can mark each command, decorate its
# prompt by exit status, and navigate between prompts.

# Guard against double-loading (e.g. nested shells).
[[ -n "${LUMINE_SHELL_INTEGRATION:-}" ]] && return
LUMINE_SHELL_INTEGRATION=1

__lumine_precmd() {
  local exit=$?
  # Report the previous command's result, then mark the start of a new prompt.
  printf '\e]133;D;%s\a' "$exit"
  printf '\e]133;A\a'
  __lumine_preexec_done=""
}

__lumine_preexec() {
  # The DEBUG trap fires before every simple command; emit "output starts" only
  # once per prompt, and never for the prompt command itself.
  [[ -n "$__lumine_preexec_done" ]] && return
  [[ "$BASH_COMMAND" == "__lumine_precmd" ]] && return
  __lumine_preexec_done=1
  printf '\e]133;C\a'
}

# Run our precmd first so it captures the real exit status before any other
# PROMPT_COMMAND entries clobber it.
case ";${PROMPT_COMMAND};" in
  *";__lumine_precmd;"*) ;;
  *) PROMPT_COMMAND="__lumine_precmd${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;
esac

trap '__lumine_preexec' DEBUG
