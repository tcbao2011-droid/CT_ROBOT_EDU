/* =====================================================
   BỘ DỊCH KHỐI BLOCKLY -> BYTECODE (chế độ "nạp nhanh")
   -----------------------------------------------------
   Chạy hoàn toàn trên trình duyệt, không cần biên dịch C++ hay máy chủ.
   Bytecode được nạp vào flash của mạch STM32 (qua Web Serial) và chạy bằng
   bộ thông dịch trong firmware (firmware/common/ct_vm.h). Mọi giá trị là float32;
   đúng/sai là 1/0. Phải khớp từng opcode với ct_vm.h.

   Gói chương trình (little-endian):
     0  "CTRB"      magic
     4  u8          phiên bản định dạng (1)
     5  u8          mã mạch (BOARD_IDS)
     6  u16         số biến (kể cả biến ẩn)
     8  u16         độ dài mã
     10 u16         dự phòng (0)
     12 u32         CRC32 của phần mã
     16 ...         mã
===================================================== */

export const FORMAT_VERSION = 1;
export const HEADER_SIZE = 16;
export const MAX_VARS = 64;

export const BOARD_IDS = { "stm32-blue-pill": 1, "stm32-black-pill": 2, "stm32-nucleo-f401re": 3 };
/** Dung lượng mã tối đa theo mạch (Blue Pill chỉ dành 4 KB cuối flash 64 KB cho chương trình). */
export const MAX_CODE_BYTES = { 1: 4096 - HEADER_SIZE, 2: 16384, 3: 16384 };

export const OP = {
  HALT: 0x00, PUSH_I8: 0x01, PUSH_I16: 0x02, PUSH_F32: 0x03, LOAD: 0x04, STORE: 0x05, DUP: 0x06, POP: 0x07,
  ADD: 0x10, SUB: 0x11, MUL: 0x12, DIV: 0x13, MOD: 0x14, POW: 0x15,
  EQ: 0x20, NEQ: 0x21, LT: 0x22, GT: 0x23, LTE: 0x24, GTE: 0x25,
  NOT: 0x2a,
  JMP: 0x30, JZ: 0x31, JNZ: 0x32,
  FN1: 0x40, MIN: 0x41, MAX: 0x42, CONSTRAIN: 0x43, BETWEEN: 0x44, RANDOM: 0x45, ROUNDP: 0x46,
  DELAY: 0x50, MILLIS: 0x51,
  SYS: 0x60,
};

export const FN1 = { SQRT: 0, ABS: 1, ROUND: 2, FLOOR: 3, CEIL: 4, SIN: 5, COS: 6, TAN: 7, ASIN: 8, ACOS: 9, ATAN: 10, LN: 11, LOG10: 12, EXP: 13, EXP10: 14 };

export const SYS = {
  LED: 0, BUZZER: 1, SERVO: 2, DISTANCE: 3, LINE_LEFT: 4, LINE_RIGHT: 5, BUTTON: 6,
  BT_HAS_KEY: 7, BT_READ: 8, BT_SEND: 9, DWRITE: 10, DREAD: 11, AREAD: 12, PWM: 13,
};

const MAX_BT_TEXT = 60;

/** "PB12" -> 28 (PA0..PA15 = 0..15, PB = 16..31, PC = 32..47). */
export function pinIndex(name) {
  const m = /^P([A-C])(\d{1,2})$/.exec(String(name).trim().toUpperCase());
  if (!m) return -1;
  const n = Number(m[2]);
  return n > 15 ? -1 : (m[1].charCodeAt(0) - 65) * 16 + n;
}

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

class CompileError extends Error {
  constructor(message, block) {
    super(message);
    this.block = block;
  }
}

const BOARD_BLOCK = /^stm32(?:bp|bk|nuc)_(.+)$/;

class Assembler {
  constructor() {
    this.bytes = [];
    this.labels = [];
    this.fixups = [];
  }
  get pc() { return this.bytes.length; }
  op(code, ...args) { this.bytes.push(code, ...args); }
  newLabel() { this.labels.push(null); return this.labels.length - 1; }
  place(label) { this.labels[label] = this.pc; }
  jump(code, label) {
    this.bytes.push(code, 0, 0);
    this.fixups.push({ at: this.pc - 2, label });
  }
  number(value) {
    if (Number.isInteger(value) && value >= -128 && value <= 127) this.op(OP.PUSH_I8, value & 0xff);
    else if (Number.isInteger(value) && value >= -32768 && value <= 32767) this.op(OP.PUSH_I16, value & 0xff, (value >> 8) & 0xff);
    else {
      const view = new DataView(new ArrayBuffer(4));
      view.setFloat32(0, value, true);
      this.op(OP.PUSH_F32, view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    }
  }
  finish() {
    for (const { at, label } of this.fixups) {
      const target = this.labels[label];
      if (target == null) throw new Error("Nhãn nhảy chưa được đặt (lỗi bộ dịch).");
      this.bytes[at] = target & 0xff;
      this.bytes[at + 1] = (target >> 8) & 0xff;
    }
    return Uint8Array.from(this.bytes);
  }
}

/**
 * @param workspace  Blockly workspace (có thể không giao diện)
 * @param opts.profileId   "stm32-blue-pill" | "stm32-black-pill" | "stm32-nucleo-f401re"
 * @returns { ok, errors:[{blockId,message}], warnings:[string], package?:Uint8Array, code?:Uint8Array, stats }
 */
export function compileWorkspace(workspace, { profileId } = {}) {
  const boardId = BOARD_IDS[profileId];
  const errors = [];
  const warnings = [];
  if (!boardId) {
    return { ok: false, errors: [{ blockId: null, message: `Mạch "${profileId}" chưa hỗ trợ chế độ nạp nhanh.` }], warnings };
  }

  const asm = new Assembler();
  const slots = new Map();
  let hiddenSlots = 0;
  const loops = []; // { breakLabel, continueLabel }

  const slotOf = id => {
    if (!slots.has(id)) slots.set(id, slots.size);
    return slots.get(id);
  };
  const hiddenSlot = () => {
    // Biến ẩn lấy chỗ sau mọi biến có tên: dùng chỉ số lớn dần từ MAX_VARS xuống.
    hiddenSlots += 1;
    return MAX_VARS - hiddenSlots;
  };

  const fail = (message, block) => { throw new CompileError(message, block); };

  const literalOf = block => {
    if (block?.type === "math_number") return Number(block.getFieldValue("NUM"));
    return null;
  };

  function value(block, name, fallback) {
    const target = block.getInputTargetBlock(name);
    if (!target) { asm.number(fallback); return; }
    expr(target);
  }

  function pin(block, fieldName = "PIN") {
    const raw = block.getFieldValue(fieldName);
    const index = pinIndex(raw);
    if (index < 0) fail(`Chân "${raw}" không hợp lệ.`, block);
    return index;
  }

  function expr(block) {
    if (block.isEnabled && block.isEnabled() === false && !block.isShadow?.()) {
      fail("Khối đang bị tắt nhưng được dùng làm giá trị.", block);
    }
    const t = block.type;
    switch (t) {
      case "math_number": asm.number(Number(block.getFieldValue("NUM"))); return;
      case "ct_boolean": asm.number(block.getFieldValue("VALUE") === "true" ? 1 : 0); return;
      case "variables_get": asm.op(OP.LOAD, slotOf(block.getFieldValue("VAR"))); return;
      case "ct_math_operation": {
        value(block, "A", 0); value(block, "B", 0);
        const map = { ADD: OP.ADD, SUB: OP.SUB, MUL: OP.MUL, DIV: OP.DIV };
        asm.op(map[block.getFieldValue("OP")] ?? OP.ADD);
        return;
      }
      case "ct_mod": value(block, "A", 0); value(block, "B", 1); asm.op(OP.MOD); return;
      case "ct_pow": value(block, "A", 0); value(block, "B", 1); asm.op(OP.POW); return;
      case "ct_math_func": {
        const id = FN1[block.getFieldValue("FUNC")];
        if (id === undefined) fail("Hàm toán chưa hỗ trợ.", block);
        value(block, "X", 0); asm.op(OP.FN1, id);
        return;
      }
      case "ct_minmax":
        value(block, "A", 0); value(block, "B", 0);
        asm.op(block.getFieldValue("OP") === "MAX" ? OP.MAX : OP.MIN);
        return;
      case "ct_constrain": value(block, "X", 0); value(block, "LO", 0); value(block, "HI", 100); asm.op(OP.CONSTRAIN); return;
      case "ct_random": value(block, "A", 1); value(block, "B", 10); asm.op(OP.RANDOM); return;
      case "ct_round_places": value(block, "X", 0); value(block, "N", 0); asm.op(OP.ROUNDP); return;
      case "ct_math_constant": {
        const constants = { PI: Math.PI, E: Math.E, GOLDEN: 1.61803399 };
        asm.number(constants[block.getFieldValue("NAME")] ?? 0);
        return;
      }
      case "ct_compare": {
        value(block, "A", 0); value(block, "B", 0);
        const map = { GT: OP.GT, LT: OP.LT, EQ: OP.EQ, GTE: OP.GTE, LTE: OP.LTE, NEQ: OP.NEQ };
        asm.op(map[block.getFieldValue("OP")] ?? OP.EQ);
        return;
      }
      case "ct_not": value(block, "VALUE", 0); asm.op(OP.NOT); return;
      case "ct_logic": {
        // Rút gọn như C++: a && b / a || b chỉ tính b khi cần.
        const end = asm.newLabel();
        value(block, "A", 0);
        asm.op(OP.DUP);
        asm.jump(block.getFieldValue("OP") === "OR" ? OP.JNZ : OP.JZ, end);
        asm.op(OP.POP);
        value(block, "B", 0);
        asm.place(end);
        asm.op(OP.NOT); asm.op(OP.NOT);
        return;
      }
      case "ct_between": value(block, "X", 0); value(block, "A", 0); value(block, "B", 10); asm.op(OP.BETWEEN); return;
      case "ct_ternary": {
        const elseL = asm.newLabel(); const endL = asm.newLabel();
        value(block, "COND", 0);
        asm.jump(OP.JZ, elseL);
        value(block, "A", 1);
        asm.jump(OP.JMP, endL);
        asm.place(elseL);
        value(block, "B", 0);
        asm.place(endL);
        return;
      }
      case "ct_millis":
        asm.op(OP.MILLIS);
        if (block.getFieldValue("UNIT") !== "MS") { asm.number(1000); asm.op(OP.DIV); }
        return;
      default: break;
    }
    const board = BOARD_BLOCK.exec(t);
    if (board) {
      switch (board[1]) {
        case "distance": asm.op(OP.SYS, SYS.DISTANCE); return;
        case "line_left": asm.op(OP.SYS, SYS.LINE_LEFT); return;
        case "line_right": asm.op(OP.SYS, SYS.LINE_RIGHT); return;
        case "button": asm.op(OP.SYS, SYS.BUTTON); return;
        case "digital_read": asm.number(pin(block)); asm.op(OP.SYS, SYS.DREAD); return;
        case "analog_read": asm.number(pin(block)); asm.op(OP.SYS, SYS.AREAD); return;
        case "bt_has_key": asm.number((block.getFieldValue("KEY") || "S").charCodeAt(0)); asm.op(OP.SYS, SYS.BT_HAS_KEY); return;
        case "bt_read": asm.op(OP.SYS, SYS.BT_READ); return;
        default: break;
      }
    }
    fail(unsupportedMessage(block), block);
  }

  function unsupportedMessage(block) {
    if (/^ct_(text|join|serial_print)/.test(block.type) || block.type.startsWith("ct_text")) return "Khối chữ chưa hỗ trợ ở chế độ nạp nhanh (bản V1).";
    if (/^ct_list|^lists_/.test(block.type)) return "Khối danh sách chưa hỗ trợ ở chế độ nạp nhanh (bản V1).";
    if (block.type === "ct_on_receive" || block.type === "ct_broadcast") return "Khối phát/nhận thông điệp chưa hỗ trợ ở chế độ nạp nhanh (bản V1).";
    return `Khối "${block.type}" chưa hỗ trợ ở chế độ nạp nhanh.`;
  }

  /** Biên dịch một chuỗi khối lệnh nối tiếp nhau (bắt đầu từ `first`). */
  function chain(first) {
    for (let block = first; block; block = block.getNextBlock()) {
      if (block.isEnabled && block.isEnabled() === false) continue;
      statement(block);
    }
  }
  const body = (block, name) => chain(block.getInputTargetBlock(name));

  function loop(buildHead, buildStep, block) {
    const head = asm.newLabel(); const cont = asm.newLabel(); const end = asm.newLabel();
    asm.place(head);
    if (buildHead) buildHead(end);
    loops.push({ breakLabel: end, continueLabel: cont });
    body(block, "DO");
    loops.pop();
    asm.place(cont);
    if (buildStep) buildStep();
    asm.jump(OP.JMP, head);
    asm.place(end);
  }

  function statement(block) {
    const t = block.type;
    switch (t) {
      case "ct_when_started": body(block, "DO"); return;
      case "ct_forever": loop(null, null, block); return;
      case "controls_if": {
        const end = asm.newLabel();
        const extra = block.getInput("ELSE") ? 1 : 0;
        let i = 0;
        while (block.getInput(`IF${i}`)) {
          const next = asm.newLabel();
          value(block, `IF${i}`, 0);
          asm.jump(OP.JZ, next);
          body(block, `DO${i}`);
          if (block.getInput(`IF${i + 1}`) || extra) asm.jump(OP.JMP, end);
          asm.place(next);
          i += 1;
        }
        if (extra) body(block, "ELSE");
        asm.place(end);
        return;
      }
      case "ct_repeat": {
        const k = hiddenSlot();
        asm.number(0); asm.op(OP.STORE, k);
        loop(end => {
          asm.op(OP.LOAD, k); value(block, "TIMES", 10); asm.op(OP.LT);
          asm.jump(OP.JZ, end);
        }, () => {
          asm.op(OP.LOAD, k); asm.number(1); asm.op(OP.ADD); asm.op(OP.STORE, k);
        }, block);
        return;
      }
      case "ct_for": {
        const v = slotOf(block.getFieldValue("VAR"));
        const stepLiteral = literalOf(block.getInputTargetBlock("BY")) ?? (block.getInputTargetBlock("BY") ? null : 1);
        const down = stepLiteral !== null && stepLiteral < 0;
        value(block, "FROM", 1); asm.op(OP.STORE, v);
        loop(end => {
          asm.op(OP.LOAD, v); value(block, "TO", 10); asm.op(down ? OP.GTE : OP.LTE);
          asm.jump(OP.JZ, end);
        }, () => {
          asm.op(OP.LOAD, v); value(block, "BY", 1); asm.op(OP.ADD); asm.op(OP.STORE, v);
        }, block);
        return;
      }
      case "ct_while":
        loop(end => { value(block, "COND", 0); asm.jump(OP.JZ, end); }, null, block);
        return;
      case "ct_repeat_until":
        loop(end => { value(block, "COND", 1); asm.jump(OP.JNZ, end); }, null, block);
        return;
      case "ct_wait_until": {
        const again = asm.newLabel(); const done = asm.newLabel();
        asm.place(again);
        value(block, "COND", 1);
        asm.jump(OP.JNZ, done);
        asm.number(1); asm.op(OP.DELAY);
        asm.jump(OP.JMP, again);
        asm.place(done);
        return;
      }
      case "ct_break":
      case "ct_continue": {
        const target = loops[loops.length - 1];
        if (!target) fail("Khối này chỉ dùng được bên trong vòng lặp.", block);
        asm.jump(OP.JMP, t === "ct_break" ? target.breakLabel : target.continueLabel);
        return;
      }
      case "variables_set": value(block, "VALUE", 0); asm.op(OP.STORE, slotOf(block.getFieldValue("VAR"))); return;
      case "math_change": {
        const v = slotOf(block.getFieldValue("VAR"));
        asm.op(OP.LOAD, v); value(block, "DELTA", 1); asm.op(OP.ADD); asm.op(OP.STORE, v);
        return;
      }
      case "ct_wait": value(block, "SECONDS", 1); asm.number(1000); asm.op(OP.MUL); asm.op(OP.DELAY); return;
      case "ct_wait_ms": value(block, "MS", 500); asm.op(OP.DELAY); return;
      case "ct_key_up": case "ct_key_down": case "ct_key_left": case "ct_key_right":
        warnings.push("Khối sự kiện phím chỉ có trong mô phỏng, bị bỏ qua khi nạp vào mạch.");
        return;
      default: break;
    }
    const board = BOARD_BLOCK.exec(t);
    if (board) {
      switch (board[1]) {
        case "led": asm.number(block.getFieldValue("STATE") === "ON" ? 1 : 0); asm.op(OP.SYS, SYS.LED); return;
        case "buzzer": value(block, "FREQ", 1000); asm.op(OP.SYS, SYS.BUZZER); return;
        case "servo": value(block, "ANGLE", 90); asm.op(OP.SYS, SYS.SERVO); return;
        case "digital_write":
          asm.number(pin(block)); asm.number(block.getFieldValue("LEVEL") === "HIGH" ? 1 : 0); asm.op(OP.SYS, SYS.DWRITE);
          return;
        case "pwm_write": asm.number(pin(block)); value(block, "VALUE", 50); asm.op(OP.SYS, SYS.PWM); return;
        case "bt_send": {
          const text = new TextEncoder().encode(String(block.getFieldValue("TEXT") ?? ""));
          if (text.length > MAX_BT_TEXT) fail(`Chuỗi Bluetooth dài quá ${MAX_BT_TEXT} byte.`, block);
          asm.op(OP.SYS, SYS.BT_SEND, text.length, ...text);
          return;
        }
        default: break;
      }
    }
    // Khối giá trị đứng riêng (không nối vào đâu) thì bỏ qua; còn lại là khối chưa hỗ trợ.
    fail(unsupportedMessage(block), block);
  }

  for (const top of workspace.getTopBlocks(true)) {
    if (top.outputConnection) continue; // khối giá trị lẻ loi
    if (top.isEnabled && top.isEnabled() === false) continue;
    try {
      chain(top);
    } catch (error) {
      if (!(error instanceof CompileError)) throw error;
      errors.push({ blockId: error.block?.id ?? null, message: error.message });
    }
  }
  asm.op(OP.HALT);

  if (errors.length) return { ok: false, errors, warnings };

  const varCount = slots.size;
  if (varCount > MAX_VARS - hiddenSlots) {
    return { ok: false, errors: [{ blockId: null, message: `Chương trình dùng quá nhiều biến (tối đa ${MAX_VARS - hiddenSlots}).` }], warnings };
  }

  let code;
  try {
    code = asm.finish();
  } catch (error) {
    return { ok: false, errors: [{ blockId: null, message: error.message }], warnings };
  }
  const limit = MAX_CODE_BYTES[boardId];
  if (code.length > limit) {
    return { ok: false, errors: [{ blockId: null, message: `Chương trình dài ${code.length} byte, vượt giới hạn ${limit} byte của mạch này. Hãy rút gọn.` }], warnings };
  }

  const pkg = new Uint8Array(HEADER_SIZE + code.length);
  const view = new DataView(pkg.buffer);
  pkg.set([0x43, 0x54, 0x52, 0x42], 0); // "CTRB"
  pkg[4] = FORMAT_VERSION;
  pkg[5] = boardId;
  view.setUint16(6, MAX_VARS, true); // vùng biến cố định, đơn giản và an toàn
  view.setUint16(8, code.length, true);
  view.setUint16(10, 0, true);
  view.setUint32(12, crc32(code), true);
  pkg.set(code, HEADER_SIZE);

  return { ok: true, errors, warnings, package: pkg, code, stats: { bytes: code.length, limit, variables: varCount } };
}
