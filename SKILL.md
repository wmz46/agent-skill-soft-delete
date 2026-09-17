---
name: soft-delete
description: MUST：当需要删除文件或目录时，必须使用本技能。将文件移入回收站可还原，而非永久删除。触发词包括"删除"、"删掉"、"清理"、"回收站"、"还原"等。
---

# Soft Delete 文件软删除

将文件移动到 `~/.agent-trash/` 回收站目录（用户主目录下），按日期自动分组存储。支持还原和查看。适用于 AI 需要清理文件但不希望弹出系统确认框的场景。

## 工具优先、脚本替底

> **优先使用原生工具**（`soft_delete` / `restore_trash` / `list_trash`）——
> 进程内执行，无 I/O 开销，支持结构化参数和富返回值。
> **原生工具不可用时**（如 remote-control 未加载、其他 Agent 无此工具）
> 降级使用脚本 `<skill>/scripts/trash.js`（行为一致，JSON 输出）。

**路由检测：** 尝试调用 `soft_delete`（或 `list_trash`）→ 报错/不可用 → 降级 `trash.js`。
检测一次后缓存结果，后续操作统一走同一路径。

**原生工具参数（替代脚本命令）：**

| 脚本命令 | 原生工具 | 参数 |
|---|---|---|
| `trash.js delete <paths...>` | `soft_delete` | `paths: ["path1", "path2"]`（绝对或相对路径数组） |
| `trash.js restore <ids...>` | `restore_trash` | `ids: ["id1", "id2"]` |
| `trash.js restore --by-path <path>` | `restore_trash` | `by_path: "/original/path"` |
| `trash.js list` | `list_trash` | 无必填参数 |
| `trash.js list --date 2026-06-09` | `list_trash` | 内置按日期过滤 |

> 脚本模式下命令通过 pwsh 执行（`node <skill>/scripts/trash.js delete ...`），
> 原生工具通过 agent tool call 直接调用（无需 pwsh 中转）。

## 脚本路径定位（替底用）

本 skill 提供一个脚本，存放于 skill 目录下的 `scripts/` 中：

| 脚本 | 说明 |
|------|------|
| `scripts/trash.js` | 文件软删除（移入回收站 `~/.agent-trash/`），支持还原/查看 |

AI 应通过 skill 的 `location` 字段拼接出脚本的绝对路径：

```
<script.location>/scripts/trash.js
```

所有命令行示例均以此路径为基础。

## 何时触发

- 用户要求删除文件或清理文件
- AI 在工作流程中需要移除临时文件、过期文件
- 用户要求还原之前删除的文件
- 用户要求查看回收站内容

所有删除操作均移入回收站 `~/.agent-trash/`，7 天内可还原。不支持永久删除。

## 环境要求

- 无需额外依赖，使用 Node.js 内置模块
- 回收站目录：`~/.agent-trash/`（用户主目录下，跨项目共享）
- 回收站保留天数：默认 7 天，过期自动清理

## 用法

以下命令中 `<script>` 表示 `scripts/trash.js` 的绝对路径（即 `<skill.location>/scripts/trash.js`）。

### 删除文件

```bash
<script> delete <file1> [file2] [file3] ...
```

示例：
```bash
<script> delete image1.png image2.jpg report.pdf
```

**输出格式**（JSON）：

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
  "summary": "成功删除 1 个文件，失败 0 个"
}
```

### 还原文件

```bash
# 按 ID 还原（支持多个 ID 批量还原）
<script> restore <id1> [id2] [id3] ...

# 按原始路径还原（同名文件被删多次时，只还原最新删除的那份）
<script> restore --by-path <original_path>
```

**自动处理路径冲突**：还原时如果目标路径已存在文件，会先将当前文件移到临时位置，再执行还原。还原成功后，临时文件才会移入回收站（标注为"被替换"）；如果还原失败，临时文件自动回滚到原路径，保证数据不丢失。

**同名多次删除**：`restore --by-path` 仅还原最新删除的文件到原始路径。较早版本仍留在回收站中，可先 `list` 查看具体 ID 再 `restore <id>` 逐个还原。

### 查看回收站

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

1. 执行 `delete` 命令
2. 执行命令并解析返回的 JSON
3. 回复格式：

   > 已将以下文件移至回收站（7 天内可还原）：
   > ‐ `image1.png`
   > ‐ `report.pdf`

   如遇错误，在回复中附带说明哪个文件失败了及原因。

### 还原文件

1. 先确认用户想还原哪个文件。可先 `list` 查看回收站内容
2. 使用 `restore <id1> [id2] ...` 或 `restore --by-path <path>` 执行还原
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


## 错误处理

- **文件不存在**：返回错误信息，继续处理其他文件
- **权限不足**：返回错误信息，提示检查文件权限
- **磁盘空间不足**：返回错误信息，建议清理回收站

## 注意事项

- **优先使用此 Skill**：当需要删除文件时，应使用此 Skill 的原生工具（`soft_delete`/`restore_trash`/`list_trash`）而非系统删除命令，避免确认框；工具不可用时用脚本替底
- **JSON 输出**：原生工具返回结构化结果；脚本 `delete` 和 `restore` 输出 JSON 格式报告到 stdout，AI 应解析并展示给用户
- **`list` 命令差异**：`list` 默认输出 JSON（供 AI 解析），加 `--pretty` 显示带 emoji 的可读文本
- **意图不明时优先伪删除**：AI 不确定用户意图时，默认使用伪删除
- **回收站路径**：`~/.agent-trash/`（用户主目录下），所有项目共享一个回收站
- **自动过期清理**：回收站中超过 7 天的过期条目会在每次操作时自动清理，无需手动维护
- **跨平台**：`~/.agent-trash/` 在 Windows 上对应 `C:\Users\<用户名>\.agent-trash\`，Linux/macOS 对应 `/home/<用户名>/.agent-trash/`
