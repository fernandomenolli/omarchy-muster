const { load, test, eq } = require("../harness.js")
const Format = load("Format.js")

test("the agent's own mark is stripped, because it is theirs and may change", () => {
  eq(Format.task("◑ Verificar e criar plugin de htop"), "Verificar e criar plugin de htop")
  eq(Format.task("✳ Implementar canal WhatsApp"), "Implementar canal WhatsApp")
})

test("a title with no mark is left alone", () => {
  eq(Format.task("Reviewing the pull request"), "Reviewing the pull request")
})

test("a title that is nothing but a mark keeps what it had", () => {
  eq(Format.task("◑"), "◑")
  eq(Format.task(""), "")
})

test("the project is the folder the agent is standing in", () => {
  eq(Format.project("/home/fernando/Projects/risecode", "/home/fernando"), "risecode")
})

test("home is not a project", () => {
  eq(Format.project("/home/fernando", "/home/fernando"), "")
  eq(Format.project("", "/home/fernando"), "")
})

test("idle time reads the way someone would say it", () => {
  eq(Format.idleFor(20000), "just now")
  eq(Format.idleFor(12 * 60000), "12m")
  eq(Format.idleFor(125 * 60000), "2h05")
})

