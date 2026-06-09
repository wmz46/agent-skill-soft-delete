const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

const RECYCLE_BASE = path.join(os.homedir(), ".agent-trash");
const MAX_AGE_DAYS = 7;

function getTodayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getNowISO() {
  return new Date().toISOString();
}

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
  const rand = crypto.randomBytes(3).toString("hex");
  return `d${ts}-${rand}`;
}

function getTodayDir() {
  return path.join(RECYCLE_BASE, getTodayStr());
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function loadManifest(dateDir) {
  const filePath = path.join(dateDir, "manifest.json");
  if (!fs.existsSync(filePath)) {
    return { date: path.basename(dateDir), entries: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return { date: path.basename(dateDir), entries: [] };
  }
}

function saveManifest(dateDir, manifest) {
  const filePath = path.join(dateDir, "manifest.json");
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2), "utf-8");
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
  const destDir = path.dirname(dest);
  ensureDir(destDir);
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    if (err.code === "EXDEV") {
      copyRecursiveSync(src, dest);
      removeRecursiveSync(src);
    } else {
      throw err;
    }
  }
}

function copyRecursiveSync(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    ensureDir(dest);
    for (const item of fs.readdirSync(src)) {
      copyRecursiveSync(
        path.join(src, item),
        path.join(dest, item)
      );
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

function removeRecursiveSync(target) {
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    for (const item of fs.readdirSync(target)) {
      removeRecursiveSync(path.join(target, item));
    }
    fs.rmdirSync(target);
  } else {
    fs.unlinkSync(target);
  }
}

function getDirectorySize(dirPath) {
  let totalSize = 0;
  const items = fs.readdirSync(dirPath);
  for (const item of items) {
    const itemPath = path.join(dirPath, item);
    const stat = fs.statSync(itemPath);
    if (stat.isDirectory()) {
      totalSize += getDirectorySize(itemPath);
    } else {
      totalSize += stat.size;
    }
  }
  return totalSize;
}

function cleanupExpiredEntries() {
  if (!fs.existsSync(RECYCLE_BASE)) return 0;
  const now = new Date();
  let cleaned = 0;
  for (const dirName of fs.readdirSync(RECYCLE_BASE)) {
    const dirPath = path.join(RECYCLE_BASE, dirName);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dirName)) continue;
    const dirDate = new Date(dirName + "T23:59:59");
    const diffDays = (now - dirDate) / (1000 * 60 * 60 * 24);
    if (diffDays > MAX_AGE_DAYS) {
      removeRecursiveSync(dirPath);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.error(`[清理] 自动清理了 ${cleaned} 个超过 ${MAX_AGE_DAYS} 天的过期日期目录`);
  }
  return cleaned;
}

function scanAllManifests() {
  if (!fs.existsSync(RECYCLE_BASE)) return [];
  const results = [];
  for (const dirName of fs.readdirSync(RECYCLE_BASE)) {
    const dirPath = path.join(RECYCLE_BASE, dirName);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    const manifestPath = path.join(dirPath, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      for (const entry of (manifest.entries || [])) {
        results.push({ ...entry, dateDir: dirName });
      }
    } catch {}
  }
  return results;
}

function findEntryById(id) {
  if (!fs.existsSync(RECYCLE_BASE)) return null;
  for (const dirName of fs.readdirSync(RECYCLE_BASE)) {
    const dirPath = path.join(RECYCLE_BASE, dirName);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    const manifestPath = path.join(dirPath, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      const idx = (manifest.entries || []).findIndex(e => e.id === id);
      if (idx !== -1) {
        return { entry: manifest.entries[idx], dateDir: dirName, manifest, index: idx };
      }
    } catch {}
  }
  return null;
}

function findEntriesByOriginalPath(originalPath) {
  const normalizedPath = path.resolve(originalPath);
  return scanAllManifests().filter(e =>
    path.resolve(e.originalPath) === normalizedPath
  );
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatListOutput(entries) {
  if (entries.length === 0) return "回收站为空";
  const lines = [];
  let lastDate = "";
  for (const e of entries) {
    if (e.dateDir !== lastDate) {
      lines.push(`\n--- ${e.dateDir} ---`);
      lastDate = e.dateDir;
    }
    const size = e.size ? formatBytes(e.size) : "?";
    const type = e.isDirectory ? "📁" : "📄";
    const tag = e.note === "因还原操作被替换" ? " (被替换)" : "";
    lines.push(`  ${type} [${e.id}] ${e.trashName}${tag} (原: ${e.originalPath}) ${size}`);
  }
  return lines.join("\n");
}

function cmdDelete(filePaths, hardDelete) {
  if (hardDelete) {
    const result = { deleted: [], errors: [] };
    for (const rawPath of filePaths) {
      const absPath = path.resolve(rawPath);
      if (!fs.existsSync(absPath)) {
        result.errors.push({ path: absPath, error: "文件不存在" });
        continue;
      }
      try {
        const stat = fs.statSync(absPath);
        const isDirectory = stat.isDirectory();
        const size = isDirectory ? getDirectorySize(absPath) : stat.size;
        removeRecursiveSync(absPath);
        result.deleted.push({ path: absPath, size, isDirectory });
      } catch (e) {
        result.errors.push({ path: absPath, error: e.message });
      }
    }
    result.summary = `成功永久删除 ${result.deleted.length} 个文件，失败 ${result.errors.length} 个`;
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const todayDir = getTodayDir();
  ensureDir(todayDir);
  const manifest = loadManifest(todayDir);
  const result = { deleted: [], errors: [] };

  for (const rawPath of filePaths) {
    const absPath = path.resolve(rawPath);
    if (!fs.existsSync(absPath)) {
      result.errors.push({ path: absPath, error: "文件不存在" });
      continue;
    }

    let stat;
    try {
      stat = fs.statSync(absPath);
    } catch (e) {
      result.errors.push({ path: absPath, error: e.message });
      continue;
    }

    const id = generateId();
    const trashName = makeTrashName(path.basename(absPath), todayDir);
    const destPath = path.join(todayDir, trashName);

    try {
      const isDirectory = stat.isDirectory();
      const entrySize = isDirectory ? getDirectorySize(absPath) : stat.size;
      moveFile(absPath, destPath);
      const entry = {
        id,
        originalPath: absPath,
        trashName,
        deletedAt: getNowISO(),
        size: entrySize,
        isDirectory
      };
      manifest.entries.push(entry);
      result.deleted.push({ id, path: absPath, trashName, dateDir: getTodayStr() });
    } catch (e) {
      result.errors.push({ path: absPath, error: e.message });
    }
  }

  saveManifest(todayDir, manifest);
  result.summary = `成功伪删除 ${result.deleted.length} 个文件，失败 ${result.errors.length} 个`;
  console.log(JSON.stringify(result, null, 2));
}

function cmdRestore(identifier, mode) {
  let entries = [];
  let extraCount = 0;

  if (mode === "id") {
    const found = findEntryById(identifier);
    if (!found) {
      console.log(JSON.stringify({ error: `未找到 ID 为 "${identifier}" 的条目` }));
      return;
    }
    entries = [{ ...found.entry, dateDir: found.dateDir }];
  } else if (mode === "path") {
    const allEntries = findEntriesByOriginalPath(identifier);
    if (allEntries.length === 0) {
      console.log(JSON.stringify({ error: `未找到原始路径为 "${identifier}" 的条目` }));
      return;
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
    try {
      const origDir = path.dirname(origPath);
      const trashPath = path.join(RECYCLE_BASE, e.dateDir, e.trashName);

      if (!fs.existsSync(trashPath)) {
        result.errors.push({ id: e.id, error: "回收站中文件已丢失", originalPath: origPath });
        continue;
      }

      ensureDir(origDir);

      if (fs.existsSync(origPath)) {
        tempPath = path.join(origDir, `.~restore-temp-${e.id}${path.extname(origPath)}`);
        tempStat = fs.statSync(origPath);
        if (tempStat.isDirectory()) {
          tempStat = { size: getDirectorySize(origPath), isDirectory: true };
        }
        moveFile(origPath, tempPath);
      }

      moveFile(trashPath, origPath);

      if (tempPath && fs.existsSync(tempPath)) {
        try {
          const todayDir = getTodayDir();
          ensureDir(todayDir);
          const manifest = loadManifest(todayDir);
          const replacedId = generateId();
          const replacedTrashName = makeTrashName(path.basename(origPath), todayDir);
          const replacedDest = path.join(todayDir, replacedTrashName);
          moveFile(tempPath, replacedDest);
          manifest.entries.push({
            id: replacedId,
            originalPath: origPath,
            trashName: replacedTrashName,
            deletedAt: getNowISO(),
            size: tempStat.size,
            isDirectory: tempStat.isDirectory(),
            note: "因还原操作被替换"
          });
          saveManifest(todayDir, manifest);
          result.replaced.push({ id: replacedId, originalPath: origPath, trashName: replacedTrashName, dateDir: getTodayStr() });
        } catch (err) {
          result.warnings.push({ id: e.id, message: `还原成功，但被替换的文件无法移入回收站，残留临时文件: ${tempPath}`, originalPath: origPath });
        }
      }

      result.restored.push({ id: e.id, originalPath: origPath, restoredTo: origPath });

      const dirPath = path.join(RECYCLE_BASE, e.dateDir);
      const manifest = loadManifest(dirPath);
      manifest.entries = manifest.entries.filter(entry => entry.id !== e.id);
      saveManifest(dirPath, manifest);
      if (manifest.entries.length === 0) {
        try {
          removeRecursiveSync(dirPath);
        } catch (_) {}
      }
    } catch (ex) {
      if (tempPath && fs.existsSync(tempPath)) {
        try {
          moveFile(tempPath, origPath);
        } catch (rollbackErr) {
          result.errors.push({ id: "rollback", error: `还原失败且回滚失败: ${rollbackErr.message}`, originalPath: origPath });
        }
      }
      result.errors.push({ id: e.id, error: ex.message });
    }
  }

  if (extraCount > 0) {
    result.note = `还有 ${extraCount} 份较早删除的同名文件留在回收站中，可用 list 查看后通过 restore <id> 逐个还原`;
  }

  result.summary = `成功还原 ${result.restored.length} 个文件${result.replaced.length > 0 ? `，替换了 ${result.replaced.length} 个现有文件` : ""}，失败 ${result.errors.length} 个`;
  console.log(JSON.stringify(result, null, 2));
}

function cmdList(dateFilter, pretty) {
  let entries = scanAllManifests();
  if (dateFilter) {
    entries = entries.filter(e => e.dateDir === dateFilter);
  }
  if (pretty) {
    console.log(formatListOutput(entries));
  } else {
    console.log(JSON.stringify({ entries, total: entries.length }, null, 2));
  }
}

function printUsage() {
  console.log(`用法: node scripts/trash.js <子命令> [参数]

子命令:
  delete [--hard] <file1> [file2] ...    伪删除文件/目录（--hard 永久删除）
  restore <id>                            按 ID 还原
  restore --by-path <path>                按原始路径还原（同名文件仅还原最新删除的那份）
  list [--date YYYY-MM-DD] [--pretty]    列出回收站内容（默认 JSON，--pretty 输出可读文本）`);
}

function main() {
  cleanupExpiredEntries();

  const args = process.argv.slice(2);
  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  const cmd = args[0];

  switch (cmd) {
    case "delete": {
      const deleteArgs = args.slice(1);
      const hardDelete = deleteArgs.includes("--hard");
      const filePaths = deleteArgs.filter(a => a !== "--hard");
      if (filePaths.length === 0) {
        console.log("用法: node scripts/trash.js delete [--hard] <file1> [file2] ...");
        process.exit(1);
      }
      cmdDelete(filePaths, hardDelete);
      break;
    }

    case "restore":
      if (args[1] === "--by-path") {
        const pathArg = args[2];
        if (!pathArg) {
          console.log("用法: node scripts/trash.js restore --by-path <original_path>");
          process.exit(1);
        }
        cmdRestore(pathArg, "path");
      } else if (args[1]) {
        cmdRestore(args[1], "id");
      } else {
        console.log("用法: node scripts/trash.js restore <id> | --by-path <path>");
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
        if (!nextVal || nextVal.startsWith("--")) {
          console.log("用法: node scripts/trash.js list [--date YYYY-MM-DD] [--pretty]");
          process.exit(1);
        }
        dateFilter = nextVal;
      }
      cmdList(dateFilter, pretty);
      break;
    }

    default:
      printUsage();
      process.exit(1);
  }
}

main();
