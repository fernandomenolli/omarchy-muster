const { load, test, eq } = require("../harness.js")
const Agents = load("Agents.js")

const SCAN = [
  "0x55896ddddfc0 196814 4768152442 claude /home/fernando/Projects/risecode",
  "0x55896de6f5a0 253544 290823567 claude /home/fernando/Projects/beep",
  "0x55896e165cc0 938768 6996894284 codex /home/fernando/Projects/meus arquivos",
].join("\n")

test("a scan line is read into a session", () => {
  eq(Agents.parseScan(SCAN)[0], {
    address: "0x55896ddddfc0",
    pid: "196814",
    written: 4768152442,
    agent: "claude",
    cwd: "/home/fernando/Projects/risecode"
  })
})

test("a path with spaces survives, which is why it comes last", () => {
  eq(Agents.parseScan(SCAN)[2].cwd, "/home/fernando/Projects/meus arquivos")
})

test("a line that is not a session is skipped rather than guessed at", () => {
  eq(Agents.parseScan("garbage\n\nnot even close").length, 0)
  eq(Agents.parseScan("0xzz 1 2 claude /tmp").length, 0)
})

test("an agent that wrote nothing since last time is waiting for you", () => {
  const before = Agents.classify([], Agents.parseScan(SCAN), 1024, 1000)
  const same = Agents.classify(before, Agents.parseScan(SCAN), 1024, 5000)
  eq(same.map(s => s.working), [false, false, false])
})

test("an agent that wrote past the threshold is working", () => {
  const before = Agents.classify([], Agents.parseScan(SCAN), 1024, 1000)
  const later = Agents.parseScan(SCAN).map(s => ({ ...s, written: s.written + 20000 }))
  eq(Agents.classify(before, later, 1024, 5000).map(s => s.working), [true, true, true])
})

test("a terminal redrawing itself is not work", () => {
  const before = Agents.classify([], Agents.parseScan(SCAN), 1024, 1000)
  const later = Agents.parseScan(SCAN).map(s => ({ ...s, written: s.written + 96 }))
  eq(Agents.classify(before, later, 1024, 5000)[0].working, false)
})

test("a session seen for the first time is given the benefit of the doubt", () => {
  eq(Agents.classify([], Agents.parseScan(SCAN), 1024, 1000)[0].working, true)
})

test("the moment it stopped is kept, not restamped on every sample", () => {
  const first = Agents.classify([], Agents.parseScan(SCAN), 1024, 1000)
  const stopped = Agents.classify(first, Agents.parseScan(SCAN), 1024, 5000)
  const later = Agents.classify(stopped, Agents.parseScan(SCAN), 1024, 90000)
  eq(later[0].idleSince, 5000)
})

test("going back to work clears the moment it stopped", () => {
  const first = Agents.classify([], Agents.parseScan(SCAN), 1024, 1000)
  const stopped = Agents.classify(first, Agents.parseScan(SCAN), 1024, 5000)
  const busy = Agents.parseScan(SCAN).map(s => ({ ...s, written: s.written + 50000 }))
  eq(Agents.classify(stopped, busy, 1024, 9000)[0].idleSince, 0)
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
