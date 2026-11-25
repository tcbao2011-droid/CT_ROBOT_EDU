import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as Blockly from "blockly";
import "../src/robotBlocks.js";
import "../src/extensions/blocklyBinding.js";
import { registerExtension } from "../src/extensions/registry.js";
import bluePill from "../src/extensions/builtin/stm32BluePill.js";
import { compileWorkspace } from "../src/firmware/bytecode.js";
import { ByteQueue, probe, uploadPackage, stopProgram, runProgram, clearProgram } from "../src/firmware/serialUploader.js";
registerExtension(bluePill);

/* Kiểm thử đầu-cuối giao thức nạp: uploader JS nói chuyện với firmware C++ thật (ct_device.h)
   chạy trên máy tính qua stdin/stdout, flash giả trong RAM. */

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctdev-"));
const bin = path.join(tmp, "host_device");
const haveCompiler = spawnSync("g++", ["-std=c++11", "-O1", "-o", bin, path.join(here, "firmware/host_device.cpp")]).status === 0;

function program(body) {
  const ws = new Blockly.Workspace();
  Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(`<xml xmlns="https://developers.google.com/blockly/xml">${body}</xml>`), ws);
  const r = compileWorkspace(ws, { profileId: "stm32-blue-pill" });
  assert.ok(r.ok, JSON.stringify(r.errors));
  return r.package;
}
const led = s => `<block type="stm32bp_led"><field name="STATE">${s}</field></block>`;
const prog = (...blocks) => program(`<block type="ct_when_started"><statement name="DO">${blocks.reduceRight((acc, b) => (acc ? b.replace(/<\/block>$/, `<next>${acc}</next></block>`) : b), "")}</statement></block>`);

function startDevice({ board = 1, cap = 4096, failWrite = 0 } = {}) {
  const child = spawn(bin, [String(board), String(cap), String(failWrite)], { stdio: ["pipe", "pipe", "pipe"] });
  const queue = new ByteQueue();
  child.stdout.on("data", d => queue.push(d));
  let trace = "";
  child.stderr.on("data", d => { trace += d; });
  return {
    link: { queue, write: data => new Promise(r => child.stdin.write(Buffer.from(data), r)) },
    trace: () => trace.split("\n").filter(l => l && l !== "READY"),
    kill: () => child.kill(),
    waitReady: async () => { while (!trace.includes("READY")) await new Promise(r => setTimeout(r, 5)); },
  };
}
const t = (name, fn) => test(name, { skip: !haveCompiler && "không có g++" }, fn);
const sleep = ms => new Promise(r => setTimeout(r, ms));

t("nạp chương trình: mạch báo thông tin, nhận, ghi flash và chạy ngay", async () => {
  const dev = startDevice();
  await dev.waitReady();
  try {
    const info = await probe(dev.link);
    assert.equal(info.boardId, 1);
    assert.equal(info.hasProgram, false);
    const progress = [];
    await uploadPackage(dev.link, prog(led("ON")), { onProgress: p => progress.push(p) });
    await sleep(50);
    assert.deepEqual(dev.trace(), ["LED 1"]);
    assert.equal(progress.at(-1), 1);
    assert.equal((await probe(dev.link)).hasProgram, true);
  } finally { dev.kill(); }
});

t("nạp chương trình mới thay thế chương trình cũ (dừng cái đang chạy)", async () => {
  const dev = startDevice();
  await dev.waitReady();
  try {
    await uploadPackage(dev.link, prog(led("ON")));
    await uploadPackage(dev.link, prog(led("OFF")));
    await sleep(50);
    assert.deepEqual(dev.trace(), ["LED 1", "LED 0"]);
  } finally { dev.kill(); }
});

t("chương trình lặp mãi vẫn nhận được lệnh dừng / chạy lại / xóa", async () => {
  const dev = startDevice();
  await dev.waitReady();
  try {
    const forever = program(`<block type="ct_forever"><statement name="DO">${led("ON").replace(/<\/block>$/, `<next><block type="ct_wait_ms"><value name="MS"><block type="math_number"><field name="NUM">20</field></block></value></block></next></block>`)}</statement></block>`);
    await uploadPackage(dev.link, forever);
    await sleep(120);
    const before = dev.trace().length;
    assert.ok(before >= 3, `đã chạy ${before} vòng`);
    assert.equal(await stopProgram(dev.link), true);
    await sleep(60);
    const stopped = dev.trace().length;
    await sleep(120);
    assert.equal(dev.trace().length, stopped, "sau X không được chạy thêm");
    assert.equal(await runProgram(dev.link), true);
    await sleep(120);
    assert.ok(dev.trace().length > stopped);
    assert.equal(await clearProgram(dev.link), true);
    assert.equal(await runProgram(dev.link), false);
    assert.equal((await probe(dev.link)).hasProgram, false);
  } finally { dev.kill(); }
});

t("sai mạch bị từ chối từ phía máy tính trước khi gửi; quá dung lượng báo rõ", async () => {
  const dev = startDevice({ board: 2 });
  await dev.waitReady();
  try {
    await assert.rejects(uploadPackage(dev.link, prog(led("ON"))), /Blue Pill.*Black Pill/);
  } finally { dev.kill(); }
  const small = startDevice({ board: 1, cap: 20 });
  await small.waitReady();
  try {
    await assert.rejects(uploadPackage(small.link, prog(led("ON"), led("OFF"))), /vượt dung lượng/);
  } finally { small.kill(); }
});

t("ghi flash lỗi được báo về, chương trình cũ không chạy bậy", async () => {
  const dev = startDevice({ failWrite: 1 });
  await dev.waitReady();
  try {
    await assert.rejects(uploadPackage(dev.link, prog(led("ON"))), /Ghi flash thất bại/);
    await sleep(50);
    assert.deepEqual(dev.trace(), []);
  } finally { dev.kill(); }
});

t("mạch không trả lời thì báo hướng dẫn kiểm tra", async () => {
  const link = { queue: new ByteQueue(), write: async () => {} };
  await assert.rejects(probe(link), /Mạch không trả lời/);
});
