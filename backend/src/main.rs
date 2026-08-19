// Same job as bin/muster-scan, written to be compared against it.
//
// Reads every process once, finds the coding agents by name, walks each one up
// to whichever ancestor owns a window, and reports how many bytes it has
// written. The window list still comes from hyprctl, which is the one thing
// that cannot be read straight from /proc.

use std::collections::HashMap;
use std::fs;
use std::process::Command;

fn main() {
    // Rust ignores SIGPIPE and panics on the failed write instead, so piping
    // this into head printed a backtrace where the shell version printed
    // nothing. Restore the default: a closed pipe ends the program quietly.
    unsafe { libc_signal_default() }

    let agents: Vec<String> = std::env::var("MUSTER_AGENTS")
        .unwrap_or_else(|_| "claude codex gemini aider opencode amp goose crush".into())
        .split_whitespace()
        .map(|s| s.to_string())
        .collect();

    // pid -> (address, title). Hand-rolled rather than pulling in a JSON
    // crate: the shape here is fixed and the point of this build is to measure
    // the work, not the dependency tree.
    let mut windows: HashMap<i32, (String, String)> = HashMap::new();
    if let Ok(out) = Command::new("hyprctl").args(["-j", "clients"]).output() {
        let text = String::from_utf8_lossy(&out.stdout);
        for chunk in text.split("\"address\": \"").skip(1) {
            let address = match chunk.find('"') {
                Some(end) => chunk[..end].to_string(),
                None => continue,
            };
            let pid = match after(chunk, "\"pid\": ") {
                Some(rest) => rest
                    .chars()
                    .take_while(|c| c.is_ascii_digit())
                    .collect::<String>()
                    .parse::<i32>()
                    .unwrap_or(0),
                None => continue,
            };
            let title = after(chunk, "\"title\": \"")
                .and_then(|rest| rest.find('"').map(|end| rest[..end].to_string()))
                .unwrap_or_default();

            if pid > 0 {
                windows.insert(pid, (address, title));
            }
        }
    }

    // One pass over /proc: parent map, and which pids are agents.
    let mut parent: HashMap<i32, i32> = HashMap::new();
    let mut found: Vec<(i32, String)> = Vec::new();

    let entries = match fs::read_dir("/proc") {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let pid: i32 = match name.parse() {
            Ok(pid) => pid,
            Err(_) => continue,
        };

        // A process can exit while this runs. That is normal and not an error.
        let stat = match fs::read_to_string(format!("/proc/{pid}/stat")) {
            Ok(stat) => stat,
            Err(_) => continue,
        };

        let (comm, rest) = match (stat.find('('), stat.rfind(')')) {
            (Some(open), Some(close)) if close > open => {
                (stat[open + 1..close].to_string(), &stat[close + 2..])
            }
            _ => continue,
        };

        if let Some(ppid) = rest.split_whitespace().nth(1).and_then(|s| s.parse().ok()) {
            parent.insert(pid, ppid);
        }
        if agents.iter().any(|a| *a == comm) {
            found.push((pid, comm));
        }
    }

    let matched: std::collections::HashSet<i32> = found.iter().map(|(pid, _)| *pid).collect();

    // How many agents are running under each session. A session with one has
    // work in flight however quiet its own terminal has gone, which is the
    // case measuring bytes gets most wrong.
    let mut under: HashMap<i32, u32> = HashMap::new();
    for (pid, _) in &found {
        let mut up = match parent.get(pid) {
            Some(&next) if next > 1 => next,
            _ => continue,
        };
        for _ in 0..12 {
            if matched.contains(&up) {
                *under.entry(up).or_insert(0) += 1;
                break;
            }
            if windows.contains_key(&up) {
                break;
            }
            match parent.get(&up) {
                Some(&next) if next > 1 => up = next,
                _ => break,
            }
        }
    }

    for (pid, agent) in &found {
        let (pid, agent) = (*pid, agent);
        let mut up = pid;
        for _ in 0..12 {
            // An agent that launches an agent is one session, not two. The
            // child writes to a pipe its parent reads rather than to the
            // terminal, so it always looks asleep, and the roll call gains a
            // member nobody can go and talk to. Whichever one owns the window
            // reports; the rest are it.
            if up != pid && matched.contains(&up) {
                break;
            }

            if let Some((address, title)) = windows.get(&up) {
                let written = fs::read_to_string(format!("/proc/{pid}/io"))
                    .ok()
                    .and_then(|io| {
                        io.lines()
                            .find(|l| l.starts_with("wchar:"))
                            .and_then(|l| l[6..].trim().parse::<u64>().ok())
                    })
                    .unwrap_or(0);

                let cwd = fs::read_link(format!("/proc/{pid}/cwd"))
                    .map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or_default();

                let nested = under.get(&pid).copied().unwrap_or(0);
                println!("{address}\t{pid}\t{written}\t{agent}\t{cwd}\t{title}\t{nested}");
                break;
            }
            match parent.get(&up) {
                Some(&next) if next > 1 => up = next,
                _ => break,
            }
        }
    }
}

fn after<'a>(text: &'a str, key: &str) -> Option<&'a str> {
    text.find(key).map(|at| &text[at + key.len()..])
}

// One libc call rather than a dependency: this is the whole reason a crate
// would have been added.
unsafe extern "C" {
    fn signal(signum: i32, handler: usize) -> usize;
}

unsafe fn libc_signal_default() {
    const SIGPIPE: i32 = 13;
    const SIG_DFL: usize = 0;
    unsafe { signal(SIGPIPE, SIG_DFL); }
}
