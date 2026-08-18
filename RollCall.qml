import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import "model/Agents.js" as Agents

// Two jobs at two speeds.
//
// Finding the agents is expensive: five hundred processes to walk, the window
// list to fetch, a directory to resolve for each one. Sixteen milliseconds.
//
// Watching them is not: it is one number, in one file, per agent. Three file
// reads and no subprocess at all.
//
// The first version did both every three seconds, which is the same mistake
// that made Daybook cost ten times more by late afternoon: redoing the whole
// job when only the measurement changed. Discovery now runs on a slow timer
// and whenever a window opens or closes; the reading runs on the fast one.
Item {
  id: root

  property int intervalMs: 3000
  property int discoverEveryMs: 30000
  property int thresholdBytes: 1024
  property string scanPath: ""
  // Whichever implementation this machine has, asked for once. Going through
  // the script every scan means paying for a bash startup to be told the same
  // answer over and over.
  property string runner: ""
  property string agents: ""

  property var found: []
  property var sessions: []

  readonly property int total: sessions.length
  readonly property int idleCount: Agents.waiting(sessions).length

  // Replacing `found` rebuilds every file view below, and a view that has just
  // been built has not read anything yet. The agent then drops out of one
  // sample, comes back as one nobody has seen before, and is given the benefit
  // of the doubt: it counts as working and the moment it stopped is forgotten.
  //
  // Discovery runs twice a minute, so the answer to "how long has it been
  // waiting" was never allowed past thirty seconds. When the same agents come
  // back, their entries are updated where they stand instead.
  function discover(text) {
    var scanned = Agents.parseScan(text)

    if (Agents.samePids(found, scanned)) {
      for (var i = 0; i < found.length; i++) {
        found[i].title = scanned[i].title
        found[i].cwd = scanned[i].cwd
        found[i].address = scanned[i].address
      }
    } else {
      found = scanned
    }

    read()
  }

  // The hot path: for each agent already found, how many bytes it has
  // written. No process is started here, which is the whole point.
  //
  // One view per agent, not one view moved from file to file. A FileView loads
  // asynchronously, so pointing a single one at three paths in a row and
  // reading each in turn hands back the same content three times, and every
  // agent ends up wearing the last one's numbers.
  //
  // So each view owns its path and keeps its own content, and a cycle reads
  // what the previous cycle asked for before asking again. That leaves the
  // reading one cycle behind, which costs nothing: the gap between two
  // consecutive samples is still three seconds either way.
  function read() {
    var scan = []
    for (var i = 0; i < found.length; i++) {
      var view = readers.objectAt(i)
      if (!view) continue

      var written = Agents.bytesWritten(view.text())
      view.reload()
      if (written < 0) continue

      scan.push({
        address: found[i].address,
        pid: found[i].pid,
        written: written,
        agent: found[i].agent,
        cwd: found[i].cwd,
        title: found[i].title
      })
    }

    sessions = Agents.classify(sessions, scan, thresholdBytes, Date.now())
  }

  Instantiator {
    id: readers
    model: root.found
    delegate: FileView {
      path: "/proc/" + modelData.pid + "/io"
      blockLoading: true
      watchChanges: false
      printErrors: false
    }
  }

  Process {
    id: discovery
    // The script directly, with the agent list handed over as an environment
    // variable. Wrapping it in `bash -c` meant building a command string from
    // two properties, and the process ran with whatever the string happened to
    // hold at that instant, which was sometimes nothing at all.
    command: [root.runner]
    environment: ({ MUSTER_AGENTS: root.agents })
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.discover(text)
    }
  }

  function rediscover() {
    if (runner === "") { if (!which.running) which.running = true; return }
    if (!discovery.running) discovery.running = true
  }

  Process {
    id: which
    command: [root.scanPath, "--which"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var picked = String(text).trim()
        root.runner = picked === "" ? root.scanPath : picked
        root.rediscover()
      }
    }
  }

  // An agent started inside a terminal that was already open announces
  // nothing, so the slow timer is the safety net rather than the mechanism.
  Timer {
    interval: root.discoverEveryMs
    running: root.scanPath !== ""
    repeat: true
    triggeredOnStart: true
    onTriggered: root.rediscover()
  }

  Timer {
    interval: root.intervalMs
    running: root.scanPath !== ""
    repeat: true
    onTriggered: root.read()
  }

  // A terminal opening or closing is the moment the roll call actually
  // changes, and it costs nothing to hear about it.
  Connections {
    target: Hyprland
    function onRawEvent(event) {
      if (!event) return
      var name = String(event.name)
      if (name === "openwindow" || name === "closewindow") settle.restart()
    }
  }

  Timer {
    id: settle
    interval: 1200
    repeat: false
    onTriggered: root.rediscover()
  }
}
