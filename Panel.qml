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


  function goTo(address) {
    Quickshell.execDetached(["hyprctl", "dispatch",
      "hl.dsp.focus({ window = \"address:" + address + "\" })"])
    close()
  }

  RollCall {
    id: roll
    intervalMs: root.intervalMs
    thresholdBytes: root.thresholdBytes
    agents: root.agents
    scanPath: Qt.resolvedUrl("bin/muster-scan").toString().replace("file://", "")
  }

  // The panel needs the waiting time to grow while it is open; nothing else
  // here is on a clock.
  Timer {
    interval: 5000
    running: root.opened
    repeat: true
    triggeredOnStart: true
    onTriggered: root.now = Date.now()
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
      return Format.task(oldest.title)
    }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    visible: roll.total > 0 || root.showWhenEmpty
    // A hand up. An agent that stops is not reporting a status, it is asking
    // you something, and the gesture for that is the one everybody learned in
    // a classroom before they learned anything else on this machine.
    //
    // It is the bar's own glyph and the bar's own way of turning red, which is
    // the whole reason it sits in the row rather than on it. Five shapes were
    // drawn by hand here first, a helmet, chevrons, a rank of marks, a
    // standard and a terminal prompt, and every one of them was either a
    // chart, a cliche, or the wrong weight beside its neighbours.
    //
    // The number appears only when it has something to say, and then it says
    // one thing: how many are waiting on you. A count sitting at nought all
    // day is a dashboard, and a dashboard is a thing you learn to stop seeing.
    text: ""
    keepSpace: true
    hasVisualContent: true
    fixedWidth: root.vertical ? -1 : content.implicitWidth + Style.space(17)
    active: roll.idleCount > 0

    // Glyph and count as two labels rather than one string, only so the gap
    // between them can be set. A space in a monospaced font is a whole cell
    // wide, which pushes the number far enough away to read as a separate
    // widget.
    Row {
      id: content
      anchors.centerIn: parent
      spacing: Style.space(3)

      readonly property color tone: button.active ? button.activeColor : button.foreground

      Text {
        anchors.verticalCenter: parent.verticalCenter
        text: "󰩏"
        color: content.tone
        font.family: root.fontFamily
        font.pixelSize: Style.font.body
        Behavior on color { ColorAnimation { duration: 220 } }
      }

      Text {
        visible: roll.idleCount > 0
        anchors.verticalCenter: parent.verticalCenter
        text: String(roll.idleCount)
        color: content.tone
        font.family: root.fontFamily
        font.pixelSize: Style.font.body
        Behavior on color { ColorAnimation { duration: 220 } }
      }
    }
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
                readonly property string taskText: Format.task(modelData.title)

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
