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
    title: "✳ Revisar cards",
    under: 0
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


// Quiet has to persist before it counts, so a test about a stopped agent has
// to let it stay stopped. Returns the state after `samples` quiet readings,
// four seconds apart.
function afterQuiet(scan, samples, options) {
  const opts = options || {}
  let state = Agents.classify([], scan, 45, 1000, opts.remembered, opts.marks)
  let at = 1000
  for (let i = 0; i < samples; i++) {
    at += 4000
    state = Agents.classify(state, scan, 45, at, opts.remembered, opts.marks)
  }
  return state
}

test("an agent that stays quiet is waiting for you", () => {
  eq(afterQuiet(Agents.parseScan(SCAN), 3).map(s => s.working), [false, false, false])
})

// One quiet reading is not a stopped agent: a session waiting on work of its
// own goes quiet in bursts, and reporting the first one is how three busy
// agents get announced as three idle ones.
test("one quiet reading is not enough to call an agent stopped", () => {
  eq(afterQuiet(Agents.parseScan(SCAN), 1).map(s => s.working), [true, true, true])
  eq(afterQuiet(Agents.parseScan(SCAN), 2).map(s => s.working), [true, true, true])
})

test("an agent that wrote past the threshold is working", () => {
  const before = Agents.classify([], Agents.parseScan(SCAN), 45, 1000)
  const later = Agents.parseScan(SCAN).map(s => ({ ...s, written: s.written + 20000 }))
  eq(Agents.classify(before, later, 45, 5000).map(s => s.working), [true, true, true])
})

test("a terminal redrawing itself is not work", () => {
  const drip = Agents.parseScan(SCAN).map(s => ({ ...s, written: s.written + 96 }))
  let state = Agents.classify([], Agents.parseScan(SCAN), 45, 1000)
  for (let i = 1; i <= 3; i++) state = Agents.classify(state, drip, 45, 1000 + i * 4000)
  eq(state[0].working, false)
})

test("a session seen for the first time is given the benefit of the doubt", () => {
  eq(Agents.classify([], Agents.parseScan(SCAN), 45, 1000)[0].working, true)
})

// The clock starts when it went quiet, not when the plugin got around to
// believing it: nobody should be told an agent has been waiting ten seconds
// less than it has.
test("the moment it stopped is the first quiet sample, not the third", () => {
  const scan = Agents.parseScan(SCAN)
  const settled = afterQuiet(scan, 3)
  eq(settled[0].idleSince, 5000)
  eq(Agents.classify(settled, scan, 45, 90000)[0].idleSince, 5000)
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
  const blinking = Agents.parseScan(SCAN).map(s => ({ ...s, written: s.written + 32 }))
  let state = Agents.classify([], Agents.parseScan(SCAN), 45, 1000)
  for (let i = 1; i <= 3; i++) state = Agents.classify(state, blinking, 45, 1000 + i * 4000)
  eq(state.map(s => s.working), [false, false, false])
})

// A shell restart is not an agent doing anything, so it must not reset the
// answer to how long that agent has been waiting.
test("classify takes back a remembered waiting time", () => {
  const scan = Agents.parseScan(SCAN)
  const key = Agents.rememberedKey(scan[0])
  const remembered = {}
  remembered[key] = 1000

  const settled = afterQuiet(scan, 3, { remembered })
  eq(settled[0].working, false)
  eq(settled[0].idleSince, 1000)
})

test("a session nobody remembers starts its clock when it went quiet", () => {
  eq(afterQuiet(Agents.parseScan(SCAN), 3, { remembered: {} })[0].idleSince, 5000)
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

// An agent that can say what it is doing beats measuring what it writes.
test("a mark saying working is taken at its word", () => {
  const scan = Agents.parseScan(SCAN)
  const first = Agents.classify([], scan, 45, 1000)
  const marks = {}
  marks[scan[0].pid] = { working: true, at: 0 }
  const quiet = afterQuiet(scan, 3, { marks })
  eq(quiet[0].working, true)
  eq(quiet[1].working, false)
})

test("a mark saying waiting carries the moment it said so", () => {
  const scan = Agents.parseScan(SCAN)
  const first = Agents.classify([], scan, 45, 500000)
  const marks = {}
  marks[scan[0].pid] = { working: false, at: 123456 }
  const stopped = Agents.classify(first, scan, 45, 504000, null, marks)
  eq(stopped[0].working, false)
  eq(stopped[0].idleSince, 123456)
})

// A stale mark must not hold a busy agent in the waiting column.
test("bytes win over a mark that says waiting", () => {
  const scan = Agents.parseScan(SCAN)
  const first = Agents.classify([], scan, 45, 1000)
  const busy = scan.map(s => ({ ...s, written: s.written + 20000 }))
  const marks = {}
  marks[scan[0].pid] = { working: false, at: 500 }
  eq(Agents.classify(first, busy, 45, 5000, null, marks)[0].working, true)
})

// An agent waiting on a shell command of its own writes almost nothing for as
// long as that command runs, and spins the whole time. The spinner is in the
// title, and a title that moves is the agent moving.
test("a title that changed counts as work", () => {
  const scan = Agents.parseScan(SCAN)
  let state = Agents.classify([], scan, 45, 1000)
  let at = 1000
  for (let i = 0; i < 4; i++) {
    at += 4000
    const stirring = scan.map((s, index) => index === 0
      ? { ...s, written: s.written + 20, title: (i % 2 ? "◐ " : "◑ ") + "same task" }
      : s)
    state = Agents.classify(state, stirring, 45, at)
  }
  eq(state[0].working, true)
  eq(state[1].working, false)
})

test("a title that never moves does not save a quiet agent", () => {
  const scan = Agents.parseScan(SCAN)
  let state = Agents.classify([], scan, 45, 1000)
  let at = 1000
  for (let i = 0; i < 4; i++) {
    at += 4000
    state = Agents.classify(state, scan.map(s => ({ ...s, written: s.written + 20 })), 45, at)
  }
  eq(state.map(s => s.working), [false, false, false])
})

// The mark animates about once a second and this looks every three, so two
// readings in a row can catch the same frame. A title that moved recently
// still counts as moving.
test("a title that moved recently still counts, even if this sample matched", () => {
  const scan = Agents.parseScan(SCAN)
  const moved = scan.map((s, i) => i === 0 ? { ...s, title: "◐ same task" } : s)
  let state = Agents.classify([], scan, 45, 1000)
  state = Agents.classify(state, moved, 45, 5000)          // title moves here
  state = Agents.classify(state, moved, 45, 9000)          // same frame twice
  state = Agents.classify(state, moved, 45, 13000)         // and again
  eq(state[0].working, true)
  // Past twelve seconds with nothing moving, the bytes have the last word.
  state = Agents.classify(state, moved, 45, 25000)
  state = Agents.classify(state, moved, 45, 29000)
  state = Agents.classify(state, moved, 45, 33000)
  eq(state[0].working, false)
})

// A session whose turn ended is showing a prompt and writing nothing, and if a
// subagent it started is still running then it is not waiting on you.
test("an agent with an agent under it is working", () => {
  const scan = Agents.parseScan(
    "0x1\t100\t500\tclaude\t/home/me/atlas\t✳ quiet\t1\n" +
    "0x2\t200\t500\tclaude\t/home/me/beep\t✳ quiet\t0")
  eq(scan.map(s => s.under), [1, 0])

  let state = Agents.classify([], scan, 45, 1000)
  for (let i = 1; i <= 4; i++) state = Agents.classify(state, scan, 45, 1000 + i * 4000)
  eq(state.map(s => s.working), [true, false])
})
