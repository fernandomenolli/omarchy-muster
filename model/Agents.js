.pragma library

// One line per running agent, as the scan prints it:
//
//   0x55896ddddfc0 196814 4768152442 claude /home/fernando/Projects/risecode
//
// The path is last because a path can contain spaces and nothing else here can.
function parseScan(text) {
  var sessions = []
  var lines = String(text || "").split("\n")

  for (var i = 0; i < lines.length; i++) {
    var parts = lines[i].trim().split(" ")
    if (parts.length < 4) continue

    var written = Number(parts[2])
    if (!/^0x[0-9a-f]+$/i.test(parts[0]) || !/^\d+$/.test(parts[1]) || isNaN(written)) continue

    sessions.push({
      address: parts[0],
      pid: parts[1],
      written: written,
      agent: parts[3],
      cwd: parts.slice(4).join(" ")
    })
  }

  return sessions
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
