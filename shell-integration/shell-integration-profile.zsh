# ------------------------------------------------------------------------------
#   Copyright (c) Microsoft Corporation. All rights reserved.
#   Licensed under the MIT License.
# ------------------------------------------------------------------------------

# Prevent recursive sourcing.
if [[ -n "$LUMINE_TERMINAL_PROFILE_INITIALIZED" ]]; then
	return
fi
export LUMINE_TERMINAL_PROFILE_INITIALIZED=1

if [[ $options[norcs] = off && -o "login" ]]; then
	if [[ -f $USER_ZDOTDIR/.zprofile ]]; then
		LUMINE_TERMINAL_ZDOTDIR=$ZDOTDIR
		ZDOTDIR=$USER_ZDOTDIR
		. $USER_ZDOTDIR/.zprofile
		ZDOTDIR=$LUMINE_TERMINAL_ZDOTDIR
	fi

	# Apply any explicit path prefix (see #99878)
	if (( ${+LUMINE_TERMINAL_PATH_PREFIX} )); then
		export PATH="$LUMINE_TERMINAL_PATH_PREFIX$PATH"
	fi
	builtin unset LUMINE_TERMINAL_PATH_PREFIX
fi
