import QtQuick
import Quickshell
import Quickshell.Io
import "model/Agents.js" as Agents

// Watches the agents running on this machine and decides, from how much each
// one has written since the last look, whether it is working or waiting.
Item {
  id: root

  property int intervalMs: 3000
  property int thresholdBytes: 1024
  property string scanPath: ""
  property string agents: ""
  property bool notifyOnStop: true

  property var sessions: []
  readonly property int total: sessions.length
  readonly property int idleCount: Agents.waiting(sessions).length

  signal stopped(var session)

  function apply(text) {
    var scan = Agents.parseScan(text)
    var next = Agents.classify(sessions, scan, thresholdBytes, Date.now())

    var announce = Agents.justStopped(sessions, next)
    sessions = next

    if (!notifyOnStop) return
    for (var i = 0; i < announce.length; i++) root.stopped(announce[i])
  }

  Process {
    id: scan
    command: ["bash", "-c", "MUSTER_AGENTS='" + root.agents + "' " + root.scanPath]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.apply(text)
    }
  }

  Timer {
    interval: root.intervalMs
    running: root.scanPath !== ""
    repeat: true
    triggeredOnStart: true
    onTriggered: if (!scan.running) scan.running = true
  }
}
