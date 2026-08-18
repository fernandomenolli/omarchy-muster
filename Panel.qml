import QtQuick
import QtQuick.Controls
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "model/Agents.js" as Agents
import "model/Format.js" as Format

// Three agents at once, three terminals all called Alacritty. This is the roll
// call: what each one is on, whether it is working or sitting there waiting for
// you, and how long it has been sitting.
Panel {
  id: root
  moduleName: "io.github.fernandomenolli.muster"
  ipcTarget: "io.github.fernandomenolli.muster"
  manageIpc: false

  readonly property int intervalMs: setting("intervalMs", 3000)
  readonly property int thresholdBytes: setting("thresholdBytes", 1024)
  readonly property bool notifyOnStop: setting("notifyOnStop", true)
  readonly property bool showWhenEmpty: setting("showWhenEmpty", false)
  readonly property string agents: setting("agents", "claude codex gemini aider opencode amp goose crush")

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color urgentColor: bar ? bar.urgent : Color.urgent
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property bool vertical: bar ? bar.vertical : false
  readonly property string home: Quickshell.env("HOME") || ""

  property real now: Date.now()

  implicitWidth: button.visible ? button.implicitWidth : 0
  implicitHeight: button.visible ? button.implicitHeight : 0

  function titleOf(address) {
    return titles[address] || ""
  }

  property var titles: ({})

  function goTo(address) {
    Quickshell.execDetached(["hyprctl", "dispatch",
      "hl.dsp.focus({ window = \"address:" + address + "\" })"])
    close()
  }

  RollCall {
    id: roll
    intervalMs: root.intervalMs
    thresholdBytes: root.thresholdBytes
    notifyOnStop: root.notifyOnStop
    agents: root.agents
    scanPath: Qt.resolvedUrl("bin/muster-scan").toString().replace("file://", "")

    // The notification carries the way back with it: clicking it focuses the
    // terminal that is waiting. Being told without being taken there is half
    // an answer, and the half that still costs you the context switch.
    onStopped: function(session) {
      var name = Format.task(root.titleOf(session.address))
      var project = Format.project(session.cwd, root.home)

      Quickshell.execDetached(["omarchy-notification-send",
        "--exec", "hyprctl dispatch \"hl.dsp.focus({ window = \\\"address:" + session.address + "\\\" })\"",
        "-g", "\udb84\udffa",
        session.agent + (project === "" ? "" : " · " + project) + " is waiting",
        name === "" ? "It stopped and is waiting for you" : name])
    }
  }

  // Window titles come from the shell's own view of Hyprland, so the roll call
  // never has to shell out for them.
  Process {
    id: titleScan
    command: ["bash", "-c", "hyprctl -j clients | jq -r '.[] | \"\\(.address)\\t\\(.title)\"'"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var map = {}
        var lines = String(text).split("\n")
        for (var i = 0; i < lines.length; i++) {
          var tab = lines[i].indexOf("\t")
          if (tab > 0) map[lines[i].slice(0, tab)] = lines[i].slice(tab + 1)
        }
        root.titles = map
      }
    }
  }

  Timer {
    interval: root.intervalMs
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: {
      root.now = Date.now()
      if (!titleScan.running) titleScan.running = true
    }
  }

  IpcHandler {
    target: "io.github.fernandomenolli.muster"
    function open(): void { root.open() }
    function close(): void { root.close() }
    function toggle(): void { root.toggle() }
    function count(): string { return roll.idleCount + "/" + roll.total }
    // Straight to whichever has been waiting longest, for a keybinding.
    function next(): string {
      var waiting = Agents.waiting(roll.sessions)
      if (waiting.length === 0) return "nothing waiting"

      var oldest = waiting[0]
      for (var i = 1; i < waiting.length; i++) {
        if (waiting[i].idleSince < oldest.idleSince) oldest = waiting[i]
      }
      root.goTo(oldest.address)
      return Format.task(root.titleOf(oldest.address))
    }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    visible: roll.total > 0 || root.showWhenEmpty
    text: root.vertical ? "󰄯" : "󰄯 " + Format.barLabel(roll.sessions)
    active: roll.idleCount > 0
    tooltipText: roll.total === 0 ? "No agents running"
      : roll.idleCount === 0 ? roll.total + " working"
      : roll.idleCount + " waiting for you"
    onPressed: function(b) {
      if (b === Qt.RightButton && roll.idleCount > 0) {
        var waiting = Agents.waiting(roll.sessions)
        root.goTo(waiting[0].address)
      } else root.toggle()
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(380))
    contentHeight: panel.fittedContentHeight(column.implicitHeight, Style.space(560))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }

      Flickable {
        anchors.fill: parent
        contentWidth: width
        contentHeight: column.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        interactive: contentHeight > height
        ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

        Column {
          id: column
          width: parent.width
          spacing: Style.space(10)

          PanelHero {
            foreground: root.foreground
            fontFamily: root.fontFamily
            title: "Muster"
            meta: roll.total === 0 ? "no agents running"
              : roll.idleCount === 0 ? roll.total + " working"
              : roll.idleCount + " of " + roll.total + " waiting for you"
            iconComponent: Component {
              Text {
                text: roll.idleCount > 0 ? "󰄰" : "󰄯"
                color: roll.idleCount > 0 ? root.urgentColor : root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.display
              }
            }
          }

          PanelSeparator { foreground: root.foreground }

          Text {
            visible: roll.total === 0
            width: parent.width
            wrapMode: Text.Wrap
            text: "Nothing running. Start an agent in a terminal and it appears here, with the task it is on and whether it is still on it."
            color: Qt.darker(root.foreground, 1.6)
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
          }

          Column {
            width: parent.width
            spacing: Style.space(2)

            Repeater {
              model: roll.sessions

              Item {
                id: row
                required property var modelData
                width: parent.width
                implicitHeight: Math.max(Style.space(38), labels.implicitHeight + Style.space(10))

                readonly property bool idle: !modelData.working
                readonly property string taskText: Format.task(root.titleOf(modelData.address))

                Rectangle {
                  anchors.fill: parent
                  radius: Style.cornerRadius
                  color: hover.containsMouse
                    ? Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.07)
                    : "transparent"
                }

                // A filled dot is an agent still going; a hollow one has
                // stopped and is the reason you opened this.
                Text {
                  id: dot
                  anchors.left: parent.left
                  anchors.leftMargin: Style.space(8)
                  anchors.verticalCenter: parent.verticalCenter
                  text: row.idle ? "󰄰" : "󰄯"
                  color: row.idle ? root.urgentColor : Qt.darker(root.foreground, 1.5)
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.icon
                }

                Column {
                  id: labels
                  anchors.left: dot.right
                  anchors.leftMargin: Style.space(10)
                  anchors.right: parent.right
                  anchors.rightMargin: Style.space(8)
                  anchors.verticalCenter: parent.verticalCenter
                  spacing: Style.space(1)

                  Text {
                    width: parent.width
                    text: row.taskText === "" ? row.modelData.agent : row.taskText
                    color: root.foreground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.body
                    elide: Text.ElideRight
                  }

                  Text {
                    width: parent.width
                    text: {
                      var project = Format.project(row.modelData.cwd, root.home)
                      var where = project === "" ? row.modelData.agent : row.modelData.agent + "  ·  " + project
                      return row.idle
                        ? where + "  ·  waiting " + Format.idleFor(root.now - row.modelData.idleSince)
                        : where + "  ·  working"
                    }
                    color: row.idle ? Qt.darker(root.urgentColor, 1.15) : Qt.darker(root.foreground, 1.5)
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.caption
                    elide: Text.ElideRight
                  }
                }

                MouseArea {
                  id: hover
                  anchors.fill: parent
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  onClicked: root.goTo(row.modelData.address)
                }
              }
            }
          }
        }
      }
    }
  }
}
