# ------------------------------------------------------------------------------
#   Copyright (c) Microsoft Corporation. All rights reserved.
#   Licensed under the MIT License.
# ------------------------------------------------------------------------------
if [[ -f $USER_ZDOTDIR/.zshenv ]]; then
	LUMINE_TERMINAL_ZDOTDIR=$ZDOTDIR
	ZDOTDIR=$USER_ZDOTDIR

	# Prevent recursion.
	if [[ $USER_ZDOTDIR != $LUMINE_TERMINAL_ZDOTDIR ]]; then
		. $USER_ZDOTDIR/.zshenv
	fi

	USER_ZDOTDIR=$ZDOTDIR
	ZDOTDIR=$LUMINE_TERMINAL_ZDOTDIR
fi
