#!/usr/bin/env node
/**
 * trash.js — 文件软删除（对齐 soft-delete-core.ts 原生工具逻辑）
 *
 * Windows 按盘符分根（C:\.agent-trash, D:\.agent-trash），同盘秒移；
 * Linux/macOS 统一 ~/.agent-trash/。还原/列表自动扫描所有盘符根目录。
 *
 * 用法: node trash.js <子命令> [参数]
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

const TRASH_DIR_NAME = ".agent-trash";
const MAX_AGE_DAYS = 7;
const NOTE_REPLACED = "因还原操作被替换";

// ── 盘符分根（对齐 soft-delete-core.ts trashRootFor） ──────────────────

/**
 * 按源文件所在盘符定位回收站根目录。
 * Windows: 盘符根（C:\.agent-trash），写入失败回退 home；
 * Linux/macOS: 统一 ~/.agent-trash/
 */
function trashRootFor(srcPath) {
  const home = path.join(os.homedir(), TRASH_DIR_NAME);
  const winMatch = /^([A-Za-z]:)[\\/]/.exec(srcPath);
  if (winMatch) {
    const driveTrash = `${winMatch[1]}:\\${TRASH_DIR_NAME}`;
    try {
      if (!fs.existsSync(driveTrash)) fs.mkdirSync(driveTrash, { recursive: true });
      return driveTrash;
    } catch {
      return home; // 盘符根不可写，回退 home
    }
  }
  return home;
}

/**
 * 扫描所有回收站根（home + 所有盘符），供 list/restore 使用。
 * 对齐 soft-delete-core.ts allTrashRoots()。
 */
function allTrashRoots() {
  const roots = [];
  const home = path.join(os.homedir(), TRASH_DIR_NAME);
  if (fs.existsSync(home)) roots.push(home);
  if (process.platform === "win32") {
    for (const drive of "CDEFGHIJKLMNOPQRSTUVWXYZ".split("")) {
      const driveTrash = `${drive}:\\${TRASH_DIR_NAME}`;
      if (driveTrash !== home && fs.existsSync(driveTrash)) roots.push(driveTrash);
    }
  }
  return roots;
}

// ── 工具函数 ────────────────────────────────────────────────────────────

function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getNowISO() { return new Date().toISOString(); }

function getHHmmss() {
  const d = new Date();
  return String(d.getHours()).padStart(2, "0") +
    String(d.getMinutes()).padStart(2, "0") +
    String(d.getSeconds()).padStart(2, "0");
}

function generateId() {
  const d = new Date();
  const ts = d.getFullYear() +
    String(d.getMonth() + 1).padStart(2, "0") +
    String(d.getDate()).padStart(2, "0") +
    String(d.getHours()).padStart(2, "0") +
    String(d.getMinutes()).padStart(2, "0") +
    String(d.getSeconds()).padStart(2, "0");
  return `d${ts}-${crypto.randomBytes(3).toString("hex")}`;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function loadManifest(dateDir) {
  const fp = path.join(dateDir, "manifest.json");
  if (!fs.existsSync(fp)) return { date: path.basename(dateDir), entries: [] };
  try { return JSON.parse(fs.readFileSync(fp, "utf-8")); }
  catch { return { date: path.basename(dateDir), entries: [] }; }
}

function saveManifest(dateDir, manifest) {
  fs.writeFileSync(path.join(dateDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
}

function makeTrashName(fileName, dateDir) {
  const parsed = path.parse(fileName);
  const ts = getHHmmss();
  let trashName = `${parsed.name}_${ts}${parsed.ext}`;
  let counter = 0;
  while (fs.existsSync(path.join(dateDir, trashName))) {
    counter++;
    trashName = `${parsed.name}_${ts}_${counter}${parsed.ext}`;
  }
  return trashName;
}

function moveFile(src, dest) {
  ensureDir(path.dirname(dest));
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    if (err.code === "EXDEV") {
      fs.cpSync(src, dest, { recursive: true });
      fs.rmSync(src, { recursive: true });
    } else {
      throw err;
    }
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

// ── 扫描（跨所有盘符根） ────────────────────────────────────────────────

function scanAllManifests() {
  const results = [];
  for (const root of allTrashRoots()) {
    if (!fs.existsSync(root)) continue;
    for (const dirName of fs.readdirSync(root)) {
      const dirPath = path.join(root, dirName);
      if (!fs.statSync(dirPath).isDirectory()) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dirName)) continue;
      const manifestPath = path.join(dirPath, "manifest.json");
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        for (const entry of (manifest.entries || [])) {
          results.push({ ...entry, dateDir: dirName, trashRoot: root });
        }
      } catch {}
    }
  }
  return results;
}

function findEntryById(id) {
  for (const root of allTrashRoots()) {
    if (!fs.existsSync(root)) continue;
    for (const dirName of fs.readdirSync(root)) {
      const dirPath = path.join(root, dirName);
      if (!fs.statSync(dirPath).isDirectory()) continue;
      const manifestPath = path.join(dirPath, "manifest.json");
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        const idx = (manifest.entries || []).findIndex(e => e.id === id);
        if (idx !== -1) return { entry: manifest.entries[idx], dateDir: dirName, trashRoot: root, manifest, index: idx };
      } catch {}
    }
  }
  return null;
}

function findEntriesByOriginalPath(originalPath) {
  return scanAllManifests().filter(e =>
    path.resolve(e.originalPath) === path.resolve(originalPath)
  );
}

function cleanupExpiredEntries() {
  let cleaned = 0;
  const now = new Date();
  for (const root of allTrashRoots()) {
    if (!fs.existsSync(root)) continue;
    for (const dirName of fs.readdirSync(root)) {
      const dirPath = path.join(root, dirName);
      if (!fs.statSync(dirPath).isDirectory()) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dirName)) continue;
      const diffDays = (now - new Date(dirName + "T23:59:59")) / 86400000;
      if (diffDays > MAX_AGE_DAYS) {
        fs.rmSync(dirPath, { recursive: true });
        cleaned++;
      }
    }
  }
  return cleaned;
}

// ── 命令 ────────────────────────────────────────────────────────────────

function cmdDelete(filePaths) {
  // 按盘符分组，每组独立 manifest（对齐 native 工具 per-drive 逻辑）
  const byTrashRoot = new Map();
  const result = { deleted: [], errors: [] };

  for (const rawPath of filePaths) {
    const absPath = path.resolve(rawPath);
    if (!fs.existsSync(absPath)) {
      result.errors.push({ path: absPath, error: "文件不存在" });
      continue;
    }
    let stat;
    try { stat = fs.statSync(absPath); } catch (e) {
      result.errors.push({ path: absPath, error: e.message });
      continue;
    }

    const trashRoot = trashRootFor(absPath);
    const dateDir = path.join(trashRoot, getTodayStr());
    let group = byTrashRoot.get(trashRoot);
    if (!group) {
      ensureDir(dateDir);
      group = { dateDir, manifest: loadManifest(dateDir), items: [] };
      byTrashRoot.set(trashRoot, group);
    }

    const id = generateId();
    const trashName = makeTrashName(path.basename(absPath), group.dateDir);
    const destPath = path.join(group.dateDir, trashName);

    try {
      const isDirectory = stat.isDirectory();
      moveFile(absPath, destPath);
      group.manifest.entries.push({
        id, originalPath: absPath, trashName,
        deletedAt: getNowISO(), size: isDirectory ? null : stat.size, isDirectory
      });
      group.items.push({ id, path: absPath, trashName, dateDir: getTodayStr() });
    } catch (e) {
      result.errors.push({ path: absPath, error: e.message });
    }
  }

  for (const [, group] of byTrashRoot) {
    saveManifest(group.dateDir, group.manifest);
  }
  result.deleted = byTrashRoot.size > 0
    ? [...byTrashRoot.values()].flatMap(g => g.items)
    : [];
  result.summary = `成功删除 ${result.deleted.length} 个文件，失败 ${result.errors.length} 个`;
  console.log(JSON.stringify(result, null, 2));
  return result.errors.length > 0 ? 1 : 0;
}

function cmdRestore(identifier, mode) {
  let entries = [];
  let extraCount = 0;

  if (mode === "id") {
    const found = findEntryById(identifier);
    if (!found) {
      console.log(JSON.stringify({ error: `未找到 ID 为 "${identifier}" 的条目` }));
      return 1;
    }
    entries = [{ ...found.entry, dateDir: found.dateDir, trashRoot: found.trashRoot }];
  } else if (mode === "ids") {
    const missing = [];
    for (const id of identifier) {
      const found = findEntryById(id);
      if (found) entries.push({ ...found.entry, dateDir: found.dateDir, trashRoot: found.trashRoot });
      else missing.push(id);
    }
    if (missing.length > 0) {
      console.log(JSON.stringify({ error: `未找到以下 ID 的条目: ${missing.join(", ")}` }));
      return 1;
    }
  } else if (mode === "path") {
    const allEntries = findEntriesByOriginalPath(identifier);
    if (allEntries.length === 0) {
      console.log(JSON.stringify({ error: `未找到原始路径为 "${identifier}" 的条目` }));
      return 1;
    }
    allEntries.sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
    entries = [allEntries[0]];
    extraCount = allEntries.length - 1;
  }

  const result = { restored: [], replaced: [], errors: [], warnings: [] };

  for (const e of entries) {
    let tempPath = null;
    let tempStat = null;
    const origPath = path.resolve(e.originalPath);
    // trashRoot 由 scan 提供（跨盘符正确）；缺失时按源文件推断
    const trashRoot = e.trashRoot || trashRootFor(origPath);
    try {
      const trashPath = path.join(trashRoot, e.dateDir, e.trashName);

      if (!fs.existsSync(trashPath)) {
        result.errors.push({ id: e.id, error: "回收站中文件已丢失", originalPath: origPath });
        // 清理失效条目
        const dirPath = path.join(trashRoot, e.dateDir);
        const manifest = loadManifest(dirPath);
        manifest.entries = manifest.entries.filter(entry => entry.id !== e.id);
        saveManifest(dirPath, manifest);
        if (manifest.entries.length === 0) {
          try { fs.rmSync(dirPath, { recursive: true }); } catch {}
        }
        continue;
      }

      ensureDir(path.dirname(origPath));

      // 路径冲突：先移走当前文件
      if (fs.existsSync(origPath)) {
        tempPath = path.join(path.dirname(origPath), `.~restore-temp-${e.id}${path.extname(origPath)}`);
        tempStat = fs.statSync(origPath);
        if (tempStat.isDirectory()) tempStat = { size: null, isDirectory: true };
        moveFile(origPath, tempPath);
      }

      moveFile(trashPath, origPath);

      // 被替换的文件移入回收站（按其所在盘符）
      if (tempPath && fs.existsSync(tempPath)) {
        try {
          const replRoot = trashRootFor(origPath);
          const todayDir = path.join(replRoot, getTodayStr());
          ensureDir(todayDir);
          const manifest = loadManifest(todayDir);
          const replacedId = generateId();
          const replacedTrashName = makeTrashName(path.basename(origPath), todayDir);
          moveFile(tempPath, path.join(todayDir, replacedTrashName));
          manifest.entries.push({
            id: replacedId, originalPath: origPath, trashName: replacedTrashName,
            deletedAt: getNowISO(), size: tempStat.size,
            isDirectory: tempStat.isDirectory(), note: NOTE_REPLACED
          });
          saveManifest(todayDir, manifest);
          result.replaced.push({ id: replacedId, originalPath: origPath, trashName: replacedTrashName, dateDir: getTodayStr() });
        } catch (err) {
          result.warnings.push({ id: e.id, message: `还原成功，但被替换文件无法移入回收站，残留: ${tempPath}`, originalPath: origPath });
        }
      }

      result.restored.push({ id: e.id, originalPath: origPath, restoredTo: origPath });

      // 从原 manifest 移除已还原条目
      const dirPath = path.join(trashRoot, e.dateDir);
      const manifest = loadManifest(dirPath);
      manifest.entries = manifest.entries.filter(entry => entry.id !== e.id);
      saveManifest(dirPath, manifest);
      if (manifest.entries.length === 0) {
        try { fs.rmSync(dirPath, { recursive: true }); } catch {}
      }
    } catch (ex) {
      if (tempPath && fs.existsSync(tempPath)) {
        try { moveFile(tempPath, origPath); } catch (rollbackErr) {
          result.errors.push({ id: "rollback", error: `还原失败且回滚失败: ${rollbackErr.message}`, originalPath: origPath });
        }
      }
      result.errors.push({ id: e.id, error: ex.message });
    }
  }

  if (extraCount > 0) result.note = `还有 ${extraCount} 份较早删除的同名文件留在回收站，可用 list 查看后 restore <id> 逐个还原`;
  result.summary = `成功还原 ${result.restored.length} 个文件${result.replaced.length > 0 ? `，替换了 ${result.replaced.length} 个现有文件` : ""}，失败 ${result.errors.length} 个`;
  console.log(JSON.stringify(result, null, 2));
  return result.errors.length > 0 ? 1 : 0;
}

function cmdList(dateFilter, pretty) {
  let entries = scanAllManifests();
  if (dateFilter) entries = entries.filter(e => e.dateDir === dateFilter);
  if (pretty) {
    if (entries.length === 0) { console.log("回收站为空"); return 0; }
    const lines = [];
    let lastDate = "";
    for (const e of entries) {
      if (e.dateDir !== lastDate) { lines.push(`\n--- ${e.dateDir} (${e.trashRoot}) ---`); lastDate = e.dateDir; }
      const size = e.size != null ? formatBytes(e.size) : "?";
      const type = e.isDirectory ? "📁" : "📄";
      const tag = e.note === NOTE_REPLACED ? " (被替换)" : "";
      lines.push(`  ${type} [${e.id}] ${e.trashName}${tag} (原: ${e.originalPath}) ${size}`);
    }
    console.log(lines.join("\n"));
  } else {
    console.log(JSON.stringify({ entries, total: entries.length }, null, 2));
  }
  return 0;
}

// ── 入口 ────────────────────────────────────────────────────────────────

function printUsage() {
  console.log(`用法: node trash.js <子命令> [参数]

子命令:
  delete <file1> [file2] ...              软删除（按盘符分根，对齐原生工具）
  restore <id1> [id2] ...                 按 ID 还原（跨盘符扫描）
  restore --by-path <path>                按原始路径还原（仅最新）
  list [--date YYYY-MM-DD] [--pretty]    列出回收站（跨所有盘符根）`);
}

function main() {
  cleanupExpiredEntries();
  const args = process.argv.slice(2);
  if (args.length === 0) { printUsage(); process.exit(1); }

  const cmd = args[0];
  let exitCode = 0;

  switch (cmd) {
    case "delete": {
      const filePaths = args.slice(1);
      if (filePaths.length === 0) { console.log("用法: node trash.js delete <file1> [file2] ..."); process.exit(1); }
      exitCode = cmdDelete(filePaths);
      break;
    }
    case "restore":
      if (args[1] === "--by-path") {
        if (!args[2]) { console.log("用法: node trash.js restore --by-path <path>"); process.exit(1); }
        exitCode = cmdRestore(args[2], "path");
      } else if (args[1]) {
        exitCode = cmdRestore(args.slice(1), "ids");
      } else {
        console.log("用法: node trash.js restore <id1> [id2] ... | --by-path <path>");
        process.exit(1);
      }
      break;
    case "list": {
      const listArgs = args.slice(1);
      const pretty = listArgs.includes("--pretty");
      const dateIdx = listArgs.indexOf("--date");
      let dateFilter = null;
      if (dateIdx !== -1) {
        const nextVal = listArgs[dateIdx + 1];
        if (!nextVal || nextVal.startsWith("--")) { console.log("用法: node trash.js list [--date YYYY-MM-DD] [--pretty]"); process.exit(1); }
        dateFilter = nextVal;
      }
      exitCode = cmdList(dateFilter, pretty);
      break;
    }
    default:
      printUsage();
      process.exit(1);
  }
  process.exit(exitCode);
}

main();
