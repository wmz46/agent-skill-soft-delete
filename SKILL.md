---
name: soft-delete
description: 当需要删除文件、清理临时文件、移除过期文件或静默删除（避免系统确认框）时使用。默认伪删除（移入回收站可还原），支持 --hard 参数永久删除。AI 根据用户表述的"彻底/永久"等关键词自动判断。
---

# Soft Delete 文件软删除

将文件移动到 `~/.agent-trash/` 回收站目录（用户主目录下），按日期自动分组存储。支持还原和查看。适用于 AI 需要清理文件但不希望弹出系统确认框的场景。

## 脚本路径定位

本 skill 提供两个脚本，存放于 skill 目录下的 `scripts/` 中：

| 脚本 | 说明 |
|------|------|
| `scripts/trash.js` | 文件软删除（移入回收站 `~/.agent-trash/`），支持还原/查看 |
| `scripts/sync.js` | 技能同步（先软删旧文件再拷贝，用于同步项目级与用户级技能） |

AI 应通过 skill 的 `location` 字段拼接出脚本的绝对路径：

```
<script.location>/scripts/trash.js
<script.location>/scripts/sync.js
```

所有命令行示例均以此路径为基础。

## 何时触发

- 用户要求删除文件或清理文件
- AI 在工作流程中需要移除临时文件、过期文件
- 用户要求还原之前删除的文件
- 用户要求查看回收站内容

### 意图判断（伪删除 vs 真删除）

AI 根据用户表述自动判断使用 `delete`（伪删除）还是 `delete --hard`（真删除）：

| 用户表述 | 推荐行为 | 命令 |
|----------|----------|------|
| "删掉"、"删除"、"清理"（无修饰词） | 伪删除 | `delete` |
| "移到回收站"、"丢进回收站"、"软删除" | 伪删除 | `delete` |
| "彻底删除"、"永久删除"、"完全删除" | 真删除 | `delete --hard` |
| "不要了"、"清除"、"抹除"、"销毁" | 真删除 | `delete --hard` |

**安全原则**：不确定时默认伪删除，回复需附带说明，格式参考下文工作流程。

## 环境要求

- 无需额外依赖，使用 Node.js 内置模块
- 回收站目录：`~/.agent-trash/`（用户主目录下，跨项目共享）
- 回收站保留天数：默认 7 天，过期自动清理

## 用法

以下命令中 `<script>` 表示 `scripts/trash.js` 的绝对路径（即 `<skill.location>/scripts/trash.js`）。

### 删除文件

```bash
# 伪删除（移到回收站）
<script> delete <file1> [file2] [file3] ...

# 永久删除（不可还原）
<script> delete --hard <file1> [file2] [file3] ...
```

示例：
```bash
<script> delete image1.png image2.jpg report.pdf
<script> delete --hard temp.zip cache.bin
```

**输出格式**（JSON）：

伪删除输出（含 id/trashName，可还原）：
```json
{
  "deleted": [
    {
      "id": "d20260609143052-abc123",
      "path": "/home/user/workspace/image1.png",
      "trashName": "image1_20260609_143052.png",
      "dateDir": "2026-06-09"
    }
  ],
  "errors": [],
  "summary": "成功伪删除 1 个文件，失败 0 个"
}
```

永久删除输出（不含 id/trashName，不可还原）：
```json
{
  "deleted": [
    {
      "path": "/home/user/workspace/temp.zip",
      "size": 102400,
      "isDirectory": false
    }
  ],
  "errors": [],
  "summary": "成功永久删除 1 个文件，失败 0 个"
}
```

### 还原文件

```bash
# 按 ID 还原
<script> restore <id>

# 按原始路径还原（同名文件被删多次时，只还原最新删除的那份）
<script> restore --by-path <original_path>
```

**自动处理路径冲突**：还原时如果目标路径已存在文件，会先将当前文件移到临时位置，再执行还原。还原成功后，临时文件才会移入回收站（标注为"被替换"）；如果还原失败，临时文件自动回滚到原路径，保证数据不丢失。

**同名多次删除**：`restore --by-path` 仅还原最新删除的文件到原始路径。较早版本仍留在回收站中，可先 `list` 查看具体 ID 再 `restore <id>` 逐个还原。

### 技能同步

将源目录/文件同步到目标位置，同步前先使用 trash.js 将目标位置的旧文件软删除（移入 `~/.agent-trash/`），再拷贝新文件。

适用于同步项目级技能目录（`skills/`）和用户级技能目录（`~/.agents/skills/`）之间的文件。

```bash
# 同步目录（目标旧文件自动软删）
<script> sync <源路径> <目标路径>

# 预览模式（仅显示变更，不执行）
<script> sync <源路径> <目标路径> --dry-run

# 永久删除旧文件（不可还原）
<script> sync <源路径> <目标路径> --hard
```

示例：

```bash
# 将项目级生图技能同步到用户级（先软删用户级旧文件再覆盖）
<script> sync skills/agnes-image-generate ~/.agents/skills/agnes-image-generate

# 预览会同步哪些文件
<script> sync skills/abc-composer ~/.agents/skills/abc-composer --dry-run
```

### 列出回收站内容

```bash
# 列出所有日期
<script> list

# 列出指定日期
<script> list --date 2026-06-09

# 显示可读格式（默认输出 JSON 供 AI 解析）
<script> list --pretty
```

## 工作原理

### 目录结构

```
~/.agent-trash/
├── 2026-06-09/
│   ├── manifest.json
│   ├── image1_20260609_143052.png
│   └── report_20260609_150000.pdf
├── 2026-06-10/
│   └── ...
└── ...
```

### 核心机制

1. **自动日期分组**：根据当前系统时间自动创建日期子目录（YYYY-MM-DD）
2. **防冲突命名**：同名文件自动添加时间戳后缀（`name_HHmmss.ext`）
3. **元数据记录**：每个日期目录内的 `manifest.json` 记录原始路径、ID、删除时间
4. **跨文件系统支持**：自动处理不同磁盘/分区间的文件移动

### manifest.json 格式

```json
{
  "date": "2026-06-09",
  "entries": [
    {
      "id": "d20260609143052-abc123",
      "originalPath": "/home/user/workspace/image.png",
      "trashName": "image_20260609_143052.png",
      "deletedAt": "2026-06-09T14:30:52.000Z",
      "size": 102400,
      "isDirectory": false
    }
  ]
}
```

## 工作流程

### 删除文件

1. 根据意图判断规则决定使用 `delete` 还是 `delete --hard`
2. 执行命令并解析返回的 JSON
3. 回复格式：

   **伪删除：**
   > 已将以下文件移至回收站（7 天内可还原）：
   > ‐ `image1.png`
   > ‐ `report.pdf`
   > 如需彻底删除请告诉我。

   **真删除：**
   > 已永久删除以下文件（不可还原）：
   > ‐ `temp.zip` (100 KB)
   > ‐ `cache.bin`

   如遇错误，在回复中附带说明哪个文件失败了及原因。

### 还原文件

1. 先确认用户想还原哪个文件。可先 `list` 查看回收站内容
2. 使用 `restore <id>` 或 `restore --by-path <path>` 执行还原
3. 解析返回 JSON，回复格式：

   > 已还原 `image1.png`。
   > （如适用）原位置的旧文件已自动移至回收站。

   如未找到条目：
   > 在回收站中未找到文件。

### 查看回收站

1. 使用 `list` 命令查看回收站内容（默认输出 JSON 供 AI 解析）
2. 向用户呈现摘要：

   > 回收站中有 3 个文件：
   > ‐ image1.png (2026-06-09, 100 KB)
   > ‐ report.pdf (2026-06-09, 2.3 MB)
   > ‐ temp.zip (2026-06-10, 500 KB)

   如回收站为空则回复：
   > 回收站为空。


### 技能同步

适用于以下场景：
- **更新用户级技能**：项目级技能修改后，同步到 `~/.agents/skills/` 使用户级技能保持最新
- **备份项目级技能**：用户级技能修改后，同步回项目 `skills/` 目录

执行流程：

1. 确定同步方向（项目→用户 或 用户→项目）
2. 使用 **AskUserQuestion** 工具向用户确认同步方向和内容
3. 用户确认后，执行 `sync` 命令，先软删目标旧文件再拷贝
4. 回复格式：

   > ✅ 同步完成：
   > ‐ 已拷贝 N 个文件
   > ‐ 已软删 M 个旧文件（可从回收站还原）

   如使用 `--hard`，回复中需提醒不可还原。

## 错误处理

- **文件不存在**：返回错误信息，继续处理其他文件
- **权限不足**：返回错误信息，提示检查文件权限
- **磁盘空间不足**：返回错误信息，建议清理回收站

## 注意事项

- **优先使用此 Skill**：当需要删除文件时，应使用此 Skill 而非系统删除命令，避免确认框
- **JSON 输出**：`delete` 和 `restore` 输出 JSON 格式报告到 stdout，AI 应解析并展示给用户
- **`list` 命令差异**：`list` 默认输出 JSON（供 AI 解析），加 `--pretty` 显示带 emoji 的可读文本
- **意图不明时优先伪删除**：AI 不确定用户意图时，默认使用伪删除，回复中附带说明可彻底删除
- **回收站路径**：`~/.agent-trash/`（用户主目录下），所有项目共享一个回收站
- **自动过期清理**：回收站中超过 7 天的过期条目会在每次操作时自动清理，无需手动维护
- **跨平台**：`~/.agent-trash/` 在 Windows 上对应 `C:\Users\<用户名>\.agent-trash\`，Linux/macOS 对应 `/home/<用户名>/.agent-trash/`
