# Lumine terminal shell integration for zsh.
#
# Source this from your ~/.zshrc:
#     source /path/to/lumine.zsh
#
# It emits OSC 133 sequences so Lumine can mark each command, decorate its
# prompt by exit status, and navigate between prompts.

# Guard against double-loading (e.g. nested shells).
[[ -n "${LUMINE_SHELL_INTEGRATION:-}" ]] && return
LUMINE_SHELL_INTEGRATION=1

autoload -Uz add-zsh-hook

__lumine_precmd() {
  local exit=$?
  # Report the previous command's result, then mark the start of a new prompt.
  print -n "\e]133;D;${exit}\a"
  print -n "\e]133;A\a"
}

__lumine_preexec() {
  # A command is about to run; its output starts here.
  print -n "\e]133;C\a"
}

add-zsh-hook precmd __lumine_precmd
add-zsh-hook preexec __lumine_preexec
