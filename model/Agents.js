.pragma library

// One line per running agent, tab separated, as the scan prints it:
//
//   0x55896ddddfc0\t196814\t4768152442\tclaude\t/home/fernando/Projects/risecode\t✳ Revisar cards
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
      title: parts[5] || ""
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
// The threshold is in bytes per sample, and the gap it has to straddle is
// enormous: twenty thousand bytes against sixty, measured on a real desktop.
// Anything in between is a terminal redrawing itself, which is not work.
function classify(previous, scan, thresholdBytes, at) {
  var byPid = {}
  for (var i = 0; i < (previous || []).length; i++) byPid[previous[i].pid] = previous[i]

  return (scan || []).map(function(session) {
    var before = byPid[session.pid]
    var working = !before || (session.written - before.written) >= thresholdBytes

    return {
      address: session.address,
      pid: session.pid,
      written: session.written,
      agent: session.agent,
      cwd: session.cwd,
      title: session.title,
      working: working,
      // The moment it stopped, kept across samples so the panel can say how
      // long it has been sitting there. A session that never worked has no
      // such moment and is not owed one.
      idleSince: working ? 0 : (before && before.idleSince ? before.idleSince : at)
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
