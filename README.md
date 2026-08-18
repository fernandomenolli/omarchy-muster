# Muster

The roll call of the coding agents running on this machine: which are working,
which are waiting for you, and how long they have been waiting.

![Three sessions, two of them waiting.](docs/panel.png)

*Three sessions, two of them waiting.*

## The problem it solves

Run three agents at once and you have three terminals, all called `Alacritty`.
You cannot tell, without clicking into each one, which is still thinking, which
finished ten minutes ago, and which is sitting there waiting for you to answer
a question.

So the agent waits. And the thing you were parallelising turns back into a
queue with you at the head of it, not knowing you are holding it up.

## Install

```bash
omarchy plugin add https://github.com/fernandomenolli/omarchy-muster.git --enable
```

Needs Omarchy 4, Hyprland, and `jq`.

## Remove

```bash
omarchy plugin remove io.github.fernandomenolli.muster
```

It writes nothing outside its own directory.

## How it knows

An agent producing output writes to its terminal. One waiting for you writes
nothing. That is the whole signal, read from `wchar` in `/proc/<pid>/io`.

Measured on a real desktop with three sessions running, over eight seconds:

```
working    20598 bytes
waiting       96 bytes
waiting       64 bytes
```

Three orders of magnitude. CPU time was tried first and is far worse: a
terminal user interface redraws whether or not anything is happening, so the
three sessions burned similar CPU while two of them were doing nothing at all.

Nothing depends on the mark an agent draws in its title. Those are theirs, and
they change between versions.

## Using it

| Action | What happens |
|---|---|
| Left click | the roll call |
| Right click | jump to the one that is waiting |
| Click a row | jump to that session |

And on a keybinding, straight to whichever has been waiting longest:

```lua
-- ~/.config/hypr/bindings/muster.lua
o.bind("SUPER + A", "Next waiting agent",
  "omarchy-shell io.github.fernandomenolli.muster next")
```

When an agent stops, a notification says which one, and clicking it takes you
there. Being told without being taken is half an answer.

## Any agent, not just one

It watches process names, and ships knowing `claude`, `codex`, `gemini`,
`aider`, `opencode`, `amp`, `goose` and `crush`. Add yours in the settings.
Anything that runs in a terminal and writes as it works belongs there.

Finding the window is done by walking up from the agent to whichever ancestor
owns one, so it does not matter how deeply your setup nests it: a shell, a
multiplexer, a wrapper script.

## What it does not do

**It cannot tell "finished" from "asking you a question".** Both look
identical from outside: the process stopped writing. What it reports is how
long it has been quiet, which is the part that makes you go and look.

**It is not a usage meter.** There are eight of those in the catalogue already.
This one is about work, not spend.

## Settings

| Setting | Default | What it does |
|---|---|---|
| Check every | 3000 ms | |
| Bytes that count as working | 1024 | the gap it straddles is enormous, so this is not delicate |
| Tell me when an agent stops | on | |
| Keep the icon with no agents | off | otherwise it only appears when there is something to say |
| Process names to watch | eight known agents | space separated |

## Tests

```bash
node tests/run.js
```

They cover `model/`: reading a scan, deciding working from waiting, keeping
the moment one stopped, and noticing the transition worth interrupting you for.

## Licence

MIT.
