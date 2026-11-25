import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as Blockly from "blockly";
import "../src/robotBlocks.js";
import "../src/extensions/blocklyBinding.js";
import { registerExtension } from "../src/extensions/registry.js";
import bluePill from "../src/extensions/builtin/stm32BluePill.js";
import blackPill from "../src/extensions/builtin/stm32BlackPill.js";
import nucleo from "../src/extensions/builtin/stm32NucleoF401RE.js";
import { compileWorkspace, pinIndex, crc32, BOARD_IDS, MAX_CODE_BYTES, HEADER_SIZE } from "../src/firmware/bytecode.js";
[bluePill, blackPill, nucleo].forEach(registerExtension);

/* Kiểm thử chéo: bytecode do JS sinh ra được chạy bởi CHÍNH bộ thông dịch C++ của firmware
   (firmware/common/ct_vm.h) biên dịch cho máy tính với phần cứng giả. */

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctvm-"));
const hostBin = path.join(tmp, "host_vm");
const gpp = spawnSync("g++", ["-std=c++11", "-O1", "-o", hostBin, path.join(here, "firmware/host_vm.cpp")]);
const haveCompiler = gpp.status === 0;

const n = v => `<block type="math_number"><field name="NUM">${v}</field></block>`;
const val = (name, inner) => `<value name="${name}">${inner}</value>`;
const stmt = (name, inner) => `<statement name="${name}">${inner}</statement>`;
const next = inner => `<next>${inner}</next>`;
const chainOf = blocks => blocks.reduceRight((acc, b) => (acc ? b.replace(/<\/block>$/, `${next(acc)}</block>`) : b), "");
const started = (...blocks) => `<block type="ct_when_started">${stmt("DO", chainOf(blocks))}</block>`;
const setVar = (id, v) => `<block type="variables_set"><field name="VAR" id="${id}">${id}</field>${val("VALUE", v)}</block>`;
const getVar = id => `<block type="variables_get"><field name="VAR" id="${id}">${id}</field></block>`;
const servo = v => `<block type="stm32bp_servo">${val("ANGLE", v)}</block>`;
const led = s => `<block type="stm32bp_led"><field name="STATE">${s}</field></block>`;
const op = (type, a, b, field) => `<block type="${type}">${field || ""}${val("A", a)}${val("B", b)}</block>`;
const arith = (o, a, b) => op("ct_math_operation", a, b, `<field name="OP">${o}</field>`);
const cmp = (o, a, b) => op("ct_compare", a, b, `<field name="OP">${o}</field>`);

function build(body, profileId = "stm32-blue-pill", vars = ["a", "b", "s"]) {
  const ws = new Blockly.Workspace();
  const xml = `<xml xmlns="https://developers.google.com/blockly/xml"><variables>${vars.map(v => `<variable id="${v}">${v}</variable>`).join("")}</variables>${body}</xml>`;
  Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(xml), ws);
  return { ws, result: compileWorkspace(ws, { profileId }) };
}

function run(body, { ms = 5000, dist = "400", profileId = "stm32-blue-pill", vars } = {}) {
  const { result } = build(body, profileId, vars);
  assert.ok(result.ok, JSON.stringify(result.errors));
  const file = path.join(tmp, `p${Math.random().toString(36).slice(2)}.bin`);
  fs.writeFileSync(file, result.package);
  const out = execFileSync(hostBin, [file, String(ms), dist, String(BOARD_IDS[profileId])], { encoding: "utf8" });
  const lines = out.trim().split("\n");
  return { lines, events: lines.filter(l => !/^(VARS|HALT|ERROR)/.test(l) && !/^\d+ HALT/.test(l)).map(l => l.split(" ").slice(1).join(" ")), raw: out, result };
}
const t = (name, fn) => test(name, { skip: !haveCompiler && "không có g++" }, fn);

t("pinIndex và CRC32 đúng", () => {
  assert.equal(pinIndex("PA0"), 0);
  assert.equal(pinIndex("PB12"), 28);
  assert.equal(pinIndex("PC13"), 45);
  assert.equal(pinIndex("PD1"), -1);
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

t("bật LED, chờ 1 giây, tắt LED: đúng thời điểm", () => {
  const { lines } = run(started(led("ON"), `<block type="ct_wait"><value name="SECONDS">${n(1)}</value></block>`, led("OFF")));
  assert.match(lines[0], /^0 LED 1$/);
  const second = lines[1].split(" ");
  assert.equal(second[1], "LED");
  assert.equal(second[2], "0");
  const at = Number(second[0]);
  assert.ok(at >= 1000 && at <= 1003, `LED tắt lúc ${at} ms`);
});

t("LẶP 3 LẦN cộng dồn biến; biến ẩn không đè biến người dùng", () => {
  const body = started(
    setVar("a", n(0)),
    `<block type="ct_repeat">${val("TIMES", n(3))}${stmt("DO", `<block type="math_change"><field name="VAR" id="a">a</field>${val("DELTA", n(2))}</block>`)}</block>`,
    servo(getVar("a")),
  );
  assert.deepEqual(run(body).events, ["SERVO 6"]);
});

t("ĐẾM tăng và ĐẾM giảm (bước âm)", () => {
  const forBlock = (from, to, by) => `<block type="ct_for"><field name="VAR" id="b">b</field>${val("FROM", n(from))}${val("TO", n(to))}${val("BY", n(by))}${stmt("DO",
    `<block type="math_change"><field name="VAR" id="a">a</field>${val("DELTA", getVar("b"))}</block>`)}</block>`;
  assert.deepEqual(run(started(setVar("a", n(0)), forBlock(1, 5, 2), servo(getVar("a")))).events, ["SERVO 9"]);
  // 5,3,1 -> 9 ; thêm 10 để phân biệt
  assert.deepEqual(run(started(setVar("a", n(10)), forBlock(5, 1, -2), servo(getVar("a")))).events, ["SERVO 19"]);
});

t("NẾU / NẾU KHÔNG THÌ NẾU / NẾU KHÔNG với cảm biến khoảng cách", () => {
  const dist = `<block type="stm32bp_distance"></block>`;
  const ifBlock = `<block type="controls_if"><mutation elseif="1" else="1"></mutation>
    ${val("IF0", cmp("LT", dist, n(20)))}${stmt("DO0", servo(n(10)))}
    ${val("IF1", cmp("LT", dist, n(60)))}${stmt("DO1", servo(n(20)))}
    ${stmt("ELSE", servo(n(30)))}</block>`;
  const body = started(`<block type="ct_repeat">${val("TIMES", n(3))}${stmt("DO", ifBlock)}</block>`);
  // mỗi vòng đọc khoảng cách 1 lần cho IF0 (+1 lần cho IF1 nếu IF0 sai): 10 | 50,50 | 100,100 ... cung cấp chuỗi đủ dài
  const { events } = run(body, { dist: "10,50,50,100,100" });
  assert.deepEqual(events, ["SERVO 10", "SERVO 20", "SERVO 30"]);
});

t("LẶP MÃI + THOÁT VÒNG LẶP + CHỜ ĐẾN KHI", () => {
  const body = started(
    setVar("a", n(0)),
    `<block type="ct_forever">${stmt("DO", chainOf([
      `<block type="ct_wait_ms"><value name="MS">${n(100)}</value></block>`,
      `<block type="math_change"><field name="VAR" id="a">a</field>${val("DELTA", n(1))}</block>`,
      `<block type="controls_if">${val("IF0", cmp("GTE", getVar("a"), n(3)))}${stmt("DO0", `<block type="ct_break"></block>`)}</block>`,
    ]))}</block>`,
    `<block type="ct_wait_until">${val("COND", cmp("GT", `<block type="ct_millis"><field name="UNIT">MS</field></block>`, n(450)))}</block>`,
    led("ON"),
  );
  const { lines } = run(body);
  const [time, name, arg] = lines[0].split(" ");
  assert.equal(`${name} ${arg}`, "LED 1");
  assert.ok(Number(time) >= 451 && Number(time) <= 460, `LED lúc ${time} ms`);
});

t("TIẾP TỤC bỏ qua phần còn lại của vòng lặp", () => {
  const body = started(
    setVar("a", n(0)),
    `<block type="ct_for"><field name="VAR" id="b">b</field>${val("FROM", n(1))}${val("TO", n(5))}${val("BY", n(1))}${stmt("DO", chainOf([
      `<block type="controls_if">${val("IF0", cmp("EQ", getVar("b"), n(3)))}${stmt("DO0", `<block type="ct_continue"></block>`)}</block>`,
      `<block type="math_change"><field name="VAR" id="a">a</field>${val("DELTA", n(1))}</block>`,
    ]))}</block>`,
    servo(getVar("a")),
  );
  assert.deepEqual(run(body).events, ["SERVO 4"]);
});

t("toán: dư, lũy thừa, căn, làm tròn, giới hạn, khoảng, ba ngôi", () => {
  const f = (type, fields, ...inputs) => `<block type="${type}">${fields}${inputs.map(([k, v]) => val(k, v)).join("")}</block>`;
  const cases = [
    [arith("ADD", n(2), arith("MUL", n(3), n(4))), 14],
    [arith("DIV", n(7), n(2)), 3], // servo làm tròn cắt về số nguyên: 3.5 -> 3
    [arith("DIV", n(7), n(0)), 0], // chia 0 -> 0
    [op("ct_mod", n(-7), n(3)), 2],
    [op("ct_pow", n(2), n(5)), 32],
    [f("ct_math_func", `<field name="FUNC">SQRT</field>`, ["X", n(81)]), 9],
    [f("ct_math_func", `<field name="FUNC">ABS</field>`, ["X", n(-12)]), 12],
    [f("ct_math_func", `<field name="FUNC">SIN</field>`, ["X", n(90)]), 1],
    [f("ct_minmax", `<field name="OP">MAX</field>`, ["A", n(3)], ["B", n(9)]), 9],
    [f("ct_constrain", "", ["X", n(500)], ["LO", n(0)], ["HI", n(77)]), 77],
    [f("ct_round_places", "", ["X", n(2.567)], ["N", n(1)]) , 2], // 2.6 -> servo 2
    [f("ct_ternary", "", ["COND", f("ct_between", "", ["X", n(5)], ["A", n(1)], ["B", n(10)])], ["A", n(42)], ["B", n(7)]), 42],
    [f("ct_ternary", "", ["COND", f("ct_not", "", ["VALUE", `<block type="ct_boolean"><field name="VALUE">true</field></block>`])], ["A", n(42)], ["B", n(7)]), 7],
    [f("ct_logic", `<field name="OP">AND</field>`, ["A", cmp("GT", n(3), n(1))], ["B", cmp("LT", n(3), n(1))]), 0],
    [f("ct_logic", `<field name="OP">OR</field>`, ["A", cmp("GT", n(3), n(1))], ["B", cmp("LT", n(3), n(1))]), 1],
    [f("ct_math_constant", `<field name="NAME">PI</field>`), 3],
    [n(1000), 180], // servo giới hạn 0..180
  ];
  for (const [expr, expected] of cases) assert.deepEqual(run(started(servo(expr))).events, [`SERVO ${expected}`], expr.slice(0, 60));
});

t("khối riêng của mạch: ghi chân, PWM, đọc chân, đọc analog, Bluetooth", () => {
  const body = started(
    `<block type="stm32bp_digital_write"><field name="PIN">PB12</field><field name="LEVEL">HIGH</field></block>`,
    `<block type="stm32bp_pwm_write"><field name="PIN">PA8</field>${val("VALUE", n(50))}</block>`,
    `<block type="controls_if">${val("IF0", cmp("EQ", `<block type="stm32bp_digital_read"><field name="PIN">PA5</field></block>`, n(1)))}${stmt("DO0", led("ON"))}</block>`,
    servo(`<block type="stm32bp_analog_read"><field name="PIN">PA1</field></block>`),
    `<block type="controls_if">${val("IF0", `<block type="stm32bp_bt_has_key"><field name="KEY">F</field></block>`)}${stmt("DO0", `<block type="stm32bp_bt_send"><field name="TEXT">xin chào</field></block>`)}</block>`,
  );
  assert.deepEqual(run(body).events, ["DW 28 1", "PWM 8 50", "LED 1", "SERVO 101", "BT xin chào"]);
});

t("khối còi kêu 200 ms rồi mới chạy tiếp", () => {
  const { lines } = run(started(`<block type="stm32bp_buzzer">${val("FREQ", n(1000))}</block>`, led("ON")));
  assert.match(lines[0], /^0 BUZ 1000$/);
  const at = Number(lines[1].split(" ")[0]);
  assert.ok(at >= 200 && at <= 203, `LED lúc ${at}`);
});

t("khối chữ / danh sách / thông điệp báo lỗi rõ ràng và chỉ đúng khối", () => {
  const { result } = build(started(`<block type="ct_serial_print">${val("TEXT", `<block type="ct_text"><field name="TEXT">a</field></block>`)}</block>`));
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /chưa hỗ trợ/);
  assert.ok(result.errors[0].blockId);
  const bc = build(started(`<block type="ct_broadcast"><field name="EVENT">x</field></block>`));
  assert.equal(bc.result.ok, false);
});

t("gói đúng header, CRC, giới hạn dung lượng Blue Pill và mã mạch", () => {
  const { result } = build(started(led("ON")));
  const pkg = result.package;
  assert.equal(String.fromCharCode(...pkg.slice(0, 4)), "CTRB");
  assert.equal(pkg[5], 1);
  assert.equal(new DataView(pkg.buffer).getUint32(12, true), crc32(result.code));
  assert.equal(build(started(led("ON")), "stm32-black-pill").result.package[5], 2);
  assert.equal(build(started(led("ON")), "stm32-nucleo-f401re").result.package[5], 3);
  // chương trình quá dài
  const many = Array.from({ length: 900 }, () => servo(n(100000))); // PUSH_F32 + SYS = 7 byte x 900 > 4080
  const big = build(started(...many));
  assert.equal(big.result.ok, false);
  assert.match(big.result.errors[0].message, /vượt giới hạn/);
  assert.equal(MAX_CODE_BYTES[1], 4096 - HEADER_SIZE);
});

t("gói sai mã mạch hoặc sai CRC bị firmware từ chối", () => {
  const { result } = build(started(led("ON")));
  const wrongBoard = path.join(tmp, "wrong.bin");
  fs.writeFileSync(wrongBoard, result.package);
  assert.match(spawnSync(hostBin, [wrongBoard, "10", "400", "2"], { encoding: "utf8" }).stdout, /BAD_PACKAGE/);
  const corrupt = Uint8Array.from(result.package);
  corrupt[corrupt.length - 2] ^= 0xff;
  const bad = path.join(tmp, "bad.bin");
  fs.writeFileSync(bad, corrupt);
  const r = spawnSync(hostBin, [bad, "10", "400", "1"], { encoding: "utf8" });
  assert.match(r.stdout, /BAD_PACKAGE/);
});
