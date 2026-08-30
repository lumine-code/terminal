# ------------------------------------------------------------------------------
#   Copyright (c) Microsoft Corporation. All rights reserved.
#   Licensed under the MIT License.
# ------------------------------------------------------------------------------

# Prevent recursive sourcing.
if [[ -n "$LUMINE_TERMINAL_LOGIN_INITIALIZED" ]]; then
	return
fi
export LUMINE_TERMINAL_LOGIN_INITIALIZED=1

ZDOTDIR=$USER_ZDOTDIR
if [[ $options[norcs] = off && -o "login" &&  -f $ZDOTDIR/.zlogin ]]; then
	. $ZDOTDIR/.zlogin
fi
