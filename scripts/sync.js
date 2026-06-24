/**
 * Sync Skills — 技能同步脚本
 *
 * 将源目录/文件同步到目标位置，同步前先使用 soft-delete 的 trash.js
 * 将目标位置已有文件软删除（移入 ~/.agent-trash/），再拷贝新文件。
 *
 * 用法:
 *   node <script> <源路径> <目标路径>              软删旧文件→拷贝
 *   node <script> <源路径> <目标路径> --dry-run    预览模式（不实际执行）
 *   node <script> <源路径> <目标路径> --hard       永久删除旧文件（不可还原）
 *
 * 示例:
 *   node scripts/sync.js skills/agnes-image-generate ~/.agents/skills/agnes-image-generate
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─── 工具函数 ────────────────────────────────────────────────────────

function resolve(...segments) {
  return path.resolve(...segments);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function relativePath(fromDir, absPath) {
  return path.relative(fromDir, absPath);
}

/** 获取当前脚本所在目录（用于定位同目录下的 trash.js） */
function getScriptDir() {
  return path.dirname(process.argv[1]);
}

/** 调用 trash.js 删除目标文件 */
function softDeleteTarget(filePath, hardDelete) {
  const trashJs = resolve(getScriptDir(), 'trash.js');
  if (!fs.existsSync(trashJs)) {
    console.error('  \u26a0\ufe0f  trash.js 未找到，跳过软删除');
    return false;
  }

  const args = hardDelete ? 'delete --hard' : 'delete';
  try {
    execSync(
      `node "${trashJs}" ${args} "${filePath}"`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return true;
  } catch {
    // trash.js 可能因为文件不存在报错，忽略
    return false;
  }
}

/** 检查路径是否为目录 */
function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** 拷贝单个文件（含父目录创建） */
function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.cpSync(src, dest, { recursive: false });
}

// ─── 核心逻辑 ────────────────────────────────────────────────────────

function collectSourceFiles(source) {
  const absSource = resolve(source);

  if (!fs.existsSync(absSource)) {
    console.error('\u274c 源路径不存在: ' + absSource);
    process.exit(1);
  }

  if (!isDirectory(absSource)) {
    const fileName = path.basename(absSource);
    return [{ relative: fileName, srcAbs: absSource }];
  }

  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, entry);
      if (isDirectory(fullPath)) {
        walk(fullPath);
      } else {
        files.push({
          relative: relativePath(absSource, fullPath),
          srcAbs: fullPath,
        });
      }
    }
  }
  walk(absSource);
  return files;
}

function runSync(source, dest, { dryRun, hardDelete }) {
  const absDest = resolve(dest);
  const files = collectSourceFiles(source);
  const absSource = resolve(source);
  const isSingleSrc = !isDirectory(absSource);

  console.log('\ud83d\udccb 共发现 ' + files.length + ' 个待同步文件');
  if (dryRun) console.log('\ud83d\udd0d [DRY RUN] 仅预览，不执行任何操作\n');
  else console.log('');

  const stats = { deleted: 0, copied: 0, errors: 0 };

  for (const file of files) {
    // 单文件源时 dest 本身就是目标路径，不再拼接 relative
    const destFile = isSingleSrc ? absDest : resolve(absDest, file.relative);
    const destExists = fs.existsSync(destFile);

    // 第 1 步：软删目标旧文件
    if (destExists) {
      const verb = hardDelete ? '永久删除' : '软删';
      console.log('  \ud83d\uddd1\ufe0f  ' + verb + ' 旧文件: ' + file.relative);
      if (!dryRun) {
        const ok = softDeleteTarget(destFile, hardDelete);
        if (ok) stats.deleted++;
      } else {
        stats.deleted++;
      }
    } else {
      console.log('  \u2795 新文件: ' + file.relative);
    }

    // 第 2 步：拷贝源文件到目标
    if (!dryRun) {
      try {
        copyFile(file.srcAbs, destFile);
        stats.copied++;
        console.log('  \u2705 已拷贝: ' + file.relative);
      } catch (e) {
        stats.errors++;
        console.error('  \u274c 拷贝失败: ' + file.relative + ' \u2014 ' + e.message);
      }
    } else {
      stats.copied++;
    }
  }

  // 汇总
  console.log('\n' + '='.repeat(50));
  console.log('\ud83d\udcca 同步完成:');
  console.log('   \u2705 已拷贝: ' + stats.copied + ' 个文件');
  console.log('   \ud83d\uddd1\ufe0f  ' + (hardDelete ? '已永久删除' : '已软删') + ': ' + stats.deleted + ' 个旧文件');
  console.log('   \u274c 错误: ' + stats.errors + ' 个');
  console.log('='.repeat(50));

  if (stats.errors > 0) process.exit(1);
}

// ─── CLI 入口 ────────────────────────────────────────────────────────

function printUsage() {
  console.log('用法:');
  console.log('  node sync.js <源路径> <目标路径> [选项]');
  console.log('');
  console.log('选项:');
  console.log('  --dry-run    预览模式，仅列出变更不执行');
  console.log('  --hard       永久删除目标旧文件（不可还原）');
  console.log('');
  console.log('示例:');
  console.log('  node sync.js skills/agnes-image-generate ~/.agents/skills/agnes-image-generate');
  console.log('  node sync.js skills/abc-composer ~/.agents/skills/abc-composer --dry-run');
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    printUsage();
    process.exit(1);
  }

  const source = args[0];
  const dest = args[1];
  const rest = args.slice(2);
  const dryRun = rest.includes('--dry-run');
  const hardDelete = rest.includes('--hard');

  runSync(source, dest, { dryRun, hardDelete });
}

main();
