---
name: soft-delete
description: 当需要删除文件但不想弹出系统确认框，或需要保留可还原的删除记录时使用。
---

# Soft Delete 文件软删除

将文件移动到 `~/.agent-trash/` 回收站目录（用户主目录下），按日期自动分组存储。支持还原和查看。适用于 AI 需要清理文件但不希望弹出系统确认框的场景。

## 何时触发

- 用户要求删除文件或清理文件
- AI 在工作流程中需要移除临时文件、过期文件
- 用户要求还原之前删除的文件
- 用户要求查看回收站内容

## 环境要求

- 无需额外依赖，使用 Node.js 内置模块
- 回收站目录：`~/.agent-trash/`（用户主目录下，跨项目共享）

## 用法

以下命令在技能根目录下执行（`scripts/` 的父目录即为技能根目录）。

### 伪删除文件

```bash
node scripts/trash.js delete <file1> [file2] [file3] ...
```

示例：
```bash
node scripts/trash.js delete image1.png image2.jpg report.pdf
```

**输出格式**（JSON）：
```json
{
  "deleted": [
    {
      "id": "d20260609143052-abc123",
      "path": "D:\\workspace\\image1.png",
      "trashName": "image1_20260609_143052.png",
      "dateDir": "2026-06-09"
    }
  ],
  "errors": [],
  "summary": "成功伪删除 1 个文件，失败 0 个"
}
```

### 还原文件

```bash
# 按 ID 还原
node scripts/trash.js restore <id>

# 按原始路径还原（同名文件被删多次时，只还原最新删除的那份）
node scripts/trash.js restore --by-path <original_path>
```

**自动处理路径冲突**：还原时如果目标路径已存在文件，会先将当前文件伪删除到回收站（标注为"被替换"），再还原文件到原位。这样两不丢失——还原的文件回到原路径，被替换的文件安全地留在回收站。

**同名多次删除**：`restore --by-path` 仅还原最新删除的文件到原始路径。较早版本仍留在回收站中，可先 `list` 查看具体 ID 再 `restore <id>` 逐个还原。

### 列出回收站内容

```bash
# 列出所有日期
node scripts/trash.js list

# 列出指定日期
node scripts/trash.js list --date 2026-06-09
```

### 列出回收站内容

## 工作原理

### 目录结构

```
~/.agent-trash\
├── 2026-06-09\
│   ├── manifest.json
│   ├── image1_20260609_143052.png
│   └── report_20260609_150000.pdf
├── 2026-06-10\
│   └── ...
└── ...
```

### 核心机制

1. **自动日期分组**：根据当前系统时间自动创建日期子目录（YYYY-MM-DD）
2. **防冲突命名**：同名文件自动添加时间戳后缀（`name_HHmmss.ext`）
3. **元数据记录**：每个日期目录内的 `manifest.json` 记录原始路径、ID、删除时间
4. **跨盘符支持**：自动处理不同磁盘间的文件移动

### manifest.json 格式

```json
{
  "date": "2026-06-09",
  "entries": [
    {
      "id": "d20260609143052-abc123",
      "originalPath": "D:\\workspace\\image.png",
      "trashName": "image_20260609_143052.png",
      "deletedAt": "2026-06-09T14:30:52.000Z",
      "size": 102400,
      "isDirectory": false
    }
  ]
}
```

## 工作流程

1. **删除文件时**：使用 `delete` 命令，读取返回的 JSON 报告中 `deleted` 数组，告知用户哪些文件已伪删除
2. **还原文件时**：先 `list` 查看回收站，再用 `restore <id>` 或 `restore --by-path <path>` 精确还原，告知用户还原结果
3. **查看回收站**：使用 `list` 命令查看当前回收站内容

## 错误处理

- **文件不存在**：返回错误信息，继续处理其他文件
- **权限不足**：返回错误信息，提示检查文件权限
- **磁盘空间不足**：返回错误信息，建议清理回收站

## 注意事项

- **优先使用此 Skill**：当需要删除文件时，应使用此 Skill 而非系统删除命令，避免确认框
- **JSON 输出**：所有命令执行后输出 JSON 格式报告到 stdout，AI 应解析并展示给用户
- **回收站路径**：`~/.agent-trash/`（用户主目录下），所有项目共享一个回收站
