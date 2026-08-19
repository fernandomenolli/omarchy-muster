const { load, test, eq } = require("../harness.js")
const Agents = load("Agents.js")

const SCAN = [
  "0x55896ddddfc0\t196814\t4768152442\tclaude\t/home/fernando/Projects/risecode\t✳ Revisar cards",
  "0x55896de6f5a0\t253544\t290823567\tclaude\t/home/fernando/Projects/beep\t◑ Implementar canal",
  "0x55896e165cc0\t938768\t6996894284\tcodex\t/home/fernando/Projects/meus arquivos\tPágina Inicial / X",
].join("\n")

test("a scan line is read into a session", () => {
  eq(Agents.parseScan(SCAN)[0], {
    address: "0x55896ddddfc0",
    pid: "196814",
    written: 4768152442,
    agent: "claude",
    cwd: "/home/fernando/Projects/risecode",
    title: "✳ Revisar cards"
  })
})

test("a path with spaces survives, because the fields are tab separated", () => {
  eq(Agents.parseScan(SCAN)[2].cwd, "/home/fernando/Projects/meus arquivos")
})

test("a title with spaces and punctuation survives too", () => {
  eq(Agents.parseScan(SCAN)[2].title, "Página Inicial / X")
})

test("a line that is not a session is skipped rather than guessed at", () => {
  eq(Agents.parseScan("garbage\n\nnot even close").length, 0)
  eq(Agents.parseScan("0xzz\t1\t2\tclaude\t/tmp").length, 0)
})

test("an agent that wrote nothing since last time is waiting for you", () => {
  const before = Agents.classify([], Agents.parseScan(SCAN), 45, 1000)
  const same = Agents.classify(before, Agents.parseScan(SCAN), 45, 5000)
  eq(same.map(s => s.working), [false, false, false])
})

test("an agent that wrote past the threshold is working", () => {
  const before = Agents.classify([], Agents.parseScan(SCAN), 45, 1000)
  const later = Agents.parseScan(SCAN).map(s => ({ ...s, written: s.written + 20000 }))
  eq(Agents.classify(before, later, 45, 5000).map(s => s.working), [true, true, true])
})

test("a terminal redrawing itself is not work", () => {
  const before = Agents.classify([], Agents.parseScan(SCAN), 45, 1000)
  const later = Agents.parseScan(SCAN).map(s => ({ ...s, written: s.written + 96 }))
  eq(Agents.classify(before, later, 45, 5000)[0].working, false)
})

test("a session seen for the first time is given the benefit of the doubt", () => {
  eq(Agents.classify([], Agents.parseScan(SCAN), 45, 1000)[0].working, true)
})

test("the moment it stopped is kept, not restamped on every sample", () => {
  const first = Agents.classify([], Agents.parseScan(SCAN), 45, 1000)
  const stopped = Agents.classify(first, Agents.parseScan(SCAN), 45, 5000)
  const later = Agents.classify(stopped, Agents.parseScan(SCAN), 45, 90000)
  eq(later[0].idleSince, 5000)
})

test("going back to work clears the moment it stopped", () => {
  const first = Agents.classify([], Agents.parseScan(SCAN), 45, 1000)
  const stopped = Agents.classify(first, Agents.parseScan(SCAN), 45, 5000)
  const busy = Agents.parseScan(SCAN).map(s => ({ ...s, written: s.written + 50000 }))
  eq(Agents.classify(stopped, busy, 45, 9000)[0].idleSince, 0)
})

test("waiting and working split the roll call", () => {
  const sessions = [{ pid: "1", working: true }, { pid: "2", working: false }]
  eq(Agents.waiting(sessions).map(s => s.pid), ["2"])
  eq(Agents.working(sessions).map(s => s.pid), ["1"])
})

test("only a session that just stopped is worth interrupting someone for", () => {
  const before = [{ pid: "1", working: true }, { pid: "2", working: false }]
  const now = [{ pid: "1", working: false }, { pid: "2", working: false }]
  eq(Agents.justStopped(before, now).map(s => s.pid), ["1"])
})

test("a session that was already idle is not announced again", () => {
  const before = [{ pid: "2", working: false }]
  eq(Agents.justStopped(before, [{ pid: "2", working: false }]), [])
})

test("the byte count is read from the one line of /proc/<pid>/io that matters", () => {
  eq(Agents.bytesWritten("rchar: 23537624072\nwchar: 4768196821\nsyscr: 6585367\n"), 4768196821)
})

test("a file that says nothing is not the same as an agent that wrote nothing", () => {
  eq(Agents.bytesWritten(""), -1)
  eq(Agents.bytesWritten("rchar: 1\nsyscr: 2\n"), -1)
  eq(Agents.bytesWritten("wchar: 0\n"), 0)
})

// The title is what a person reads in the panel, and it is the one field that
// only exists in the scan: losing it here shows every row as "claude".
test("classify carries the task through", () => {
  const scan = [{ pid: "1", address: "0x1", written: 10, agent: "claude",
                  cwd: "/home/me/atlas", title: "\u2733 Wire the importer" }]
  const [session] = Agents.classify([], scan, 45, 1000)
  eq(session.title, "\u2733 Wire the importer")
  eq(session.cwd, "/home/me/atlas")
})

// Two scans of the same machine must agree on the order, because the reading
// pairs each agent with a file by position.
test("parseScan orders by pid", () => {
  const text = [
    "0x3\t900\t10\tclaude\t/home/me/c\tthird",
    "0x1\t100\t10\tclaude\t/home/me/a\tfirst",
    "0x2\t500\t10\tclaude\t/home/me/b\tsecond"
  ].join("\n")

  eq(Agents.parseScan(text).map(s => s.pid), ["100", "500", "900"])
})

test("samePids ignores everything but who is there", () => {
  const before = [{ pid: "1", written: 10 }, { pid: "2", written: 10 }]
  eq(Agents.samePids(before, [{ pid: "1", written: 99 }, { pid: "2", written: 5 }]), true)
  eq(Agents.samePids(before, [{ pid: "1" }]), false)
  eq(Agents.samePids(before, [{ pid: "1" }, { pid: "3" }]), false)
})

// An agent that launches an agent shares its terminal. Two rows for one window
// is a roll call with a member nobody can go and talk to, and the child never
// writes to the terminal so it is always the one that looks asleep.
test("parseScan keeps one session per window", () => {
  const text = [
    "0x1\t100\t500\tclaude\t/home/me/atlas\tthe task",
    "0x1\t900\t0\tclaude\t/home/me/atlas\tthe task",
    "0x2\t300\t500\tclaude\t/home/me/ledger\tanother"
  ].join("\n")

  const sessions = Agents.parseScan(text)
  eq(sessions.map(s => s.address), ["0x1", "0x2"])
  eq(sessions.map(s => s.pid), ["100", "300"])
})

// The band the first version got wrong. A session waiting on a background
// agent of its own draws a spinner and a clock and nothing else: about a
// hundred bytes a second, measured. It is busy, and it is not asking you for
// anything, so it is working.
test("a session that is busy and silent is working", () => {
  const first = Agents.classify([], Agents.parseScan(SCAN), 45, 1000)
  const spinner = Agents.parseScan(SCAN).map(s => ({ ...s, written: s.written + 400 }))
  eq(Agents.classify(first, spinner, 45, 5000).map(s => s.working), [true, true, true])
})

// And the one below it, which is a cursor blinking at a prompt.
test("a session waiting on you is not", () => {
  const first = Agents.classify([], Agents.parseScan(SCAN), 45, 1000)
  const blinking = Agents.parseScan(SCAN).map(s => ({ ...s, written: s.written + 32 }))
  eq(Agents.classify(first, blinking, 45, 5000).map(s => s.working), [false, false, false])
})

// A shell restart is not an agent doing anything, so it must not reset the
// answer to how long that agent has been waiting.
test("classify takes back a remembered waiting time", () => {
  const scan = Agents.parseScan(SCAN)
  const key = Agents.rememberedKey(scan[0])
  const remembered = {}
  remembered[key] = 1000

  // Two samples, because nothing is known from one: the first gives the
  // benefit of the doubt, the second is the first real measurement.
  const first = Agents.classify([], scan, 45, 500000, remembered)
  eq(first[0].working, true)

  const second = Agents.classify(first, scan, 45, 504000, remembered)
  eq(second[0].working, false)
  eq(second[0].idleSince, 1000)
})

test("a session nobody remembers starts its clock now", () => {
  const scan = Agents.parseScan(SCAN)
  const first = Agents.classify([], scan, 45, 500000, {})
  eq(Agents.classify(first, scan, 45, 504000, {})[0].idleSince, 504000)
})

test("the key is the pid and the window, not the pid alone", () => {
  const [a, b] = Agents.parseScan(SCAN)
  eq(Agents.rememberedKey(a) === Agents.rememberedKey(b), false)
  eq(Agents.rememberedKey({ pid: "7", address: "0x1" }), "7:0x1")
})

test("waitingSignature changes only when the waiting does", () => {
  const a = [{ pid: "1", address: "0x1", working: false, idleSince: 100 }]
  const b = [{ pid: "1", address: "0x1", working: false, idleSince: 100 }]
  const c = [{ pid: "1", address: "0x1", working: false, idleSince: 900 }]
  eq(Agents.waitingSignature(a), Agents.waitingSignature(b))
  eq(Agents.waitingSignature(a) === Agents.waitingSignature(c), false)
  eq(Agents.waitingSignature([{ pid: "1", address: "0x1", working: true }]), "")
})

// You open the roll call to find who is waiting on you. Sorting by pid puts
// that answer wherever the kernel happened to put it.
test("forDisplay puts the ones waiting on you first, longest first", () => {
  const sessions = [
    { pid: "300", address: "0x3", working: true },
    { pid: "100", address: "0x1", working: false, idleSince: 9000 },
    { pid: "200", address: "0x2", working: true },
    { pid: "400", address: "0x4", working: false, idleSince: 3000 }
  ]
  eq(Agents.forDisplay(sessions).map(s => s.pid), ["400", "100", "200", "300"])
})

test("forDisplay does not disturb the list it is given", () => {
  const sessions = [{ pid: "2", working: true }, { pid: "1", working: false, idleSince: 5 }]
  Agents.forDisplay(sessions)
  eq(sessions.map(s => s.pid), ["2", "1"])
})
