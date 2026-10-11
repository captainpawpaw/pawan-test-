# Claude Usage Widget

A small always-on-top Windows widget that shows how much of your Claude plan you've used, and keeps it up to date.

It shows:

- **Current session (5h)**: your rolling 5-hour limit
- **Weekly**: your weekly limit, plus separate per-model weekly limits when your plan has them
- A countdown to when each limit resets

Each bar is Claude orange normally, turns amber at your warning level (80% by default, with a beep), and red at 95%.

## Run it

You need [Python 3.10+ for Windows](https://www.python.org/downloads/windows/). The default installer includes everything the widget uses, so there's nothing else to install.

- Double-click **`run.bat`**, or
- run `pyw claude_usage_widget.py`

To build a standalone **`ClaudeUsageWidget.exe`** you can pin or share, double-click **`build.bat`**. The exe ends up in `dist\`.

## Signing in

The widget reads your usage from one of two places. Pick one in Settings (⚙).

1. **Claude Code login (easiest).** If you use [Claude Code](https://claude.com/claude-code) and have signed in with your Claude account, the widget finds the login in `%USERPROFILE%\.claude\.credentials.json` without any setup. Claude Code renews that login itself, so if the widget says it has expired, open Claude Code once.
2. **claude.ai session key.** Sign in at claude.ai, press F12, then go to **Application → Cookies → https://claude.ai** and copy the value of `sessionKey`. Paste it into Settings.

The session key works like a password for your Claude account. It is saved only on your PC, in `%APPDATA%\ClaudeUsageWidget\config.json`. Don't share that file.

## Using it

- **Drag** the title bar to move the widget. It remembers where you put it.
- **⟳** refreshes now, **⚙** opens Settings, **✕** quits.
- **Right-click** anywhere on the widget for the same options, plus *Always on top*.
- In Settings you can set the refresh interval (60 seconds by default, minimum 15), the warning level, and **Start with Windows**.

To check your setup from a terminal, run `py claude_usage_widget.py --once`. It prints your current usage and exits.

## Limitations

Anthropic doesn't publish an official API for plan usage. The widget uses the same endpoints that claude.ai's **Settings → Usage** page and Claude Code's `/usage` command use, so it may stop working if Anthropic changes them. claude.ai sometimes answers scripts with a Cloudflare check. If the session-key method fails for that reason, use the Claude Code login instead.
