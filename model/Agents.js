.pragma library

// One line per running agent, tab separated, as the scan prints it:
//
//   0x55896ddddfc0\t196814\t4768152442\tclaude\t/home/me/atlas\t✳ Revisar cards\t0
//
// The last field is how many agents are running under that one.
//
// Tabs rather than spaces: a window title is written by whatever program owns
// the window, and half of them contain spaces.
function parseScan(text) {
  var sessions = []
  var lines = String(text || "").split("\n")

  for (var i = 0; i < lines.length; i++) {
    var parts = lines[i].split("\t")
    if (parts.length < 4) continue

    var written = Number(parts[2])
    if (!/^0x[0-9a-f]+$/i.test(parts[0]) || !/^\d+$/.test(parts[1]) || isNaN(written)) continue

    sessions.push({
      address: parts[0],
      pid: parts[1],
      written: written,
      agent: parts[3],
      cwd: parts[4] || "",
      title: parts[5] || "",
      under: Number(parts[6]) || 0
    })
  }

  // One entry per window. The scan already drops an agent whose parent is an
  // agent, and this is the same rule kept here so the panel cannot show two
  // rows that both take you to the same terminal: a person goes to a window,
  // not to a process.
  var byWindow = {}
  var unique = []
  for (var j = 0; j < sessions.length; j++) {
    if (byWindow[sessions[j].address]) continue
    byWindow[sessions[j].address] = true
    unique.push(sessions[j])
  }
  sessions = unique

  // By pid, so the order does not depend on the order the kernel happened to
  // hand the processes over. The reading below pairs each agent with a file
  // view by position, and a list that reshuffles between scans pairs them
  // wrongly.
  sessions.sort(function(a, b) { return Number(a.pid) - Number(b.pid) })
  return sessions
}

// Whether two scans found the same agents, regardless of what they are doing.
function samePids(a, b) {
  if ((a || []).length !== (b || []).length) return false
  for (var i = 0; i < a.length; i++) if (a[i].pid !== b[i].pid) return false
  return true
}

// An agent producing output is working; one waiting for you writes nothing.
//
// The rate is what matters, not the amount, because the gap between the two
// is measured in bytes a second and the checking interval is a setting. The
// three states, measured on a real desktop:
//
//   waiting for you        8 bytes a second, which is a cursor blinking
//   busy and silent      100 bytes a second, a spinner and a clock, no output
//   producing output     700 bytes a second and up
//
// A session waiting on a background agent of its own sits in the middle band:
// it is not asking you for anything, so it counts as working. The first
// version drew the line at a thousand bytes a check, which put the line above
// that band, and a session that was busy and quiet was reported as one waiting
// on you.
// What a remembered waiting time is filed under. The pid alone would be
// enough almost always and wrong the once: pids come round again. The window
// address is the other half, and a shell restarting does not disturb it,
// which is the whole case this is for.
function rememberedKey(session) {
  return String(session.pid) + ":" + String(session.address)
}

function classify(previous, scan, bytesPerSecond, at, remembered, marks, patience) {
  var byPid = {}
  for (var i = 0; i < (previous || []).length; i++) byPid[previous[i].pid] = previous[i]

  return (scan || []).map(function(session) {
    var before = byPid[session.pid]
    var seconds = before && before.sampledAt ? (at - before.sampledAt) / 1000 : 0
    var rate = seconds > 0 ? (session.written - before.written) / seconds : 0
    // Nothing is known until two samples apart have been taken, and an agent
    // nobody has measured yet gets the benefit of the doubt.
    var measured = seconds > 0
    // An agent that can say what it is doing beats measuring what it writes.
    // A mark saying it is working is taken at its word; a mark saying it is
    // waiting is taken unless the bytes say plainly otherwise, because a
    // stale mark should not be able to hold a busy agent in the waiting
    // column forever.
    var mark = marks ? marks[session.pid] : null
    // One quiet sample is not a stopped agent. A session waiting on work of
    // its own goes quiet in bursts, and reporting it the first time it does is
    // how three busy agents get announced as three idle ones. It has to stay
    // quiet: three samples, about ten seconds, before it counts.
    //
    // The clock still starts at the first quiet sample, so nobody is told an
    // agent has been waiting ten seconds less than it has.
    var recalled = remembered ? remembered[rememberedKey(session)] : 0
    var wait = patience || 3

    // A title that changed is an agent doing something. The mark an agent
    // draws while it works animates, and the task it names changes as it goes,
    // so a title that moved between two samples is activity even when almost
    // nothing was written — which is exactly the case bytes get wrong: an
    // agent waiting on a shell command of its own spins for a minute and
    // writes a few dozen bytes.
    //
    // Nothing here knows which marks mean what, and that is the point: those
    // are the agent's and they change between versions. A title that does not
    // move is the only thing being read.
    // Remembered rather than compared against the last sample alone: the mark
    // animates about once a second and this looks every three, so two readings
    // in a row can catch the same frame by chance. Twelve seconds since the
    // title last moved still counts as moving.
    // An agent running under this one is work in flight. The session's own
    // terminal can be perfectly quiet — the turn ended and it is showing a
    // prompt — while a subagent it started is still going, and telling you it
    // is waiting on you then is telling you the wrong thing.
    var busyBelow = (session.under || 0) > 0

    var stirred = before && before.title !== undefined && session.title !== before.title
    var stirredAt = stirred ? at : ((before && before.stirredAt) || 0)
    var moving = stirredAt > 0 && (at - stirredAt) < 12000
    var below = measured && rate < bytesPerSecond && !moving && !busyBelow
    var quiet = below ? ((before && before.quiet) || 0) + 1 : 0
    var quietSince = !below ? 0 : (before && before.quietSince ? before.quietSince : at)

    var working = true
    if (mark && mark.working) working = true
    else if (mark && below) working = false
    else if (below && quiet >= wait) working = false

    return {
      address: session.address,
      pid: session.pid,
      written: session.written,
      sampledAt: at,
      quiet: quiet,
      quietSince: quietSince,
      stirredAt: stirredAt,
      agent: session.agent,
      cwd: session.cwd,
      title: session.title,
      under: session.under || 0,
      working: working,
      // The moment it stopped, kept across samples so the panel can say how
      // long it has been sitting there. A session that never worked has no
      // such moment and is not owed one.
      // The moment it stopped. Kept across samples, and across a restart of
      // the shell: a session that has been waiting forty minutes has been
      // waiting forty minutes, whatever happened to the thing watching it.
      // A mark carries the moment the agent said so, which is exact where
      // sampling is only close.
      idleSince: working ? 0
        : (mark && mark.at ? mark.at
          : (before && before.idleSince ? before.idleSince
            : (recalled || quietSince || at)))
    }
  })
}

function waiting(sessions) {
  return (sessions || []).filter(function(session) { return !session.working })
}

function working(sessions) {
  return (sessions || []).filter(function(session) { return session.working })
}

// Sessions that just stopped working, which is the only moment worth
// interrupting someone for.
function justStopped(previous, current) {
  var wasWorking = {}
  for (var i = 0; i < (previous || []).length; i++) {
    if (previous[i].working) wasWorking[previous[i].pid] = true
  }

  return (current || []).filter(function(session) {
    return !session.working && wasWorking[session.pid] === true
  })
}

// /proc/<pid>/io, of which one line matters:
//
//   wchar: 4768196821
//
// Returns -1 rather than zero when the file says nothing, because zero is a
// real answer meaning the agent has written nothing at all.
function bytesWritten(text) {
  var match = String(text || "").match(/^wchar:\s+(\d+)/m)
  return match ? Number(match[1]) : -1
}

// What is worth writing down: who is waiting and since when. Comparing this
// against the last one written is what keeps the file from being rewritten
// every three seconds for no reason.
function waitingSignature(sessions) {
  return waiting(sessions)
    .map(function(session) { return rememberedKey(session) + "@" + session.idleSince })
    .sort()
    .join("|")
}

// The order to read them in. You open the roll call to find out who is waiting
// on you, so those come first and the one that has been waiting longest is at
// the top; the rest follow in the order the scan settled on. Sorting by pid,
// which is what the scan needs so each agent stays paired with its own file,
// puts the answer wherever the kernel happened to put it.
function forDisplay(sessions) {
  return (sessions || []).slice().sort(function(a, b) {
    if (a.working !== b.working) return a.working ? 1 : -1
    if (!a.working && !b.working) return (a.idleSince || 0) - (b.idleSince || 0)
    return Number(a.pid) - Number(b.pid)
  })
}
