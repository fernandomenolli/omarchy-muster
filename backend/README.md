# backend

The same scan as `bin/muster-scan`, in Rust, for the machines a build exists
for. `bin/muster-scan` hands over to it when there is one and does the work
itself when there is not, so nothing here is required to run the plugin.

It is kept because the bash version is the readable definition of what the
binary does. Read that one to know what this one is doing.

## Building

```bash
cd backend && cargo build --release
install -Dm755 target/release/muster-scan dist/$(uname -m)/muster-scan
```

## Measured

Thirty runs of each, on the machine both were written on:

```
bash + awk + jq + hyprctl    15.7 ms
rust + hyprctl                8.3 ms
hyprctl alone, paid by both   3.0 ms
```

Discovery runs twice a minute, so the difference is fourteen milliseconds a
minute. It is here because it costs nothing to keep, not because the plugin
needed it.
