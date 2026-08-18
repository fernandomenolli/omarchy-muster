.pragma library

// The agent writes its own task into the window title, prefixed with a mark
// that changes as it works. The mark is theirs and may change; the task is
// what a person reads, so the mark is stripped and nothing depends on it.
function task(title) {
  var text = String(title || "").trim()
  var stripped = text.replace(/^[^\w\s]+\s*/, "").trim()
  return stripped === "" ? text : stripped
}

function project(cwd, home) {
  var path = String(cwd || "")
  if (path === "" || path === home) return ""

  var parts = path.split("/").filter(function(part) { return part !== "" })
  return parts.length === 0 ? "" : parts[parts.length - 1]
}

function idleFor(ms) {
  var minutes = Math.floor(ms / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return minutes + "m"

  var hours = Math.floor(minutes / 60)
  var rest = minutes % 60
  return hours + "h" + (rest < 10 ? "0" : "") + rest
}

// What the bar says. Silence when everything is still working, because a
// number that never changes stops being read.
function barLabel(sessions) {
  var idle = 0
  for (var i = 0; i < (sessions || []).length; i++) if (!sessions[i].working) idle++

  if ((sessions || []).length === 0) return ""
  return idle === 0 ? String(sessions.length) : idle + "/" + sessions.length
}
