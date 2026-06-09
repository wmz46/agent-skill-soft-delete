# agent-skill-soft-delete

AI Agent 文件伪删除 Skill。将文件移动到回收站而非彻底删除，避免系统确认框，支持还原。

## 安装

```bash
# 克隆到你的 AI Agent 的 skills 目录下
cd <your-workspace>/.agents/skills/
git clone https://github.com/wmz46/agent-skill-soft-delete.git soft-delete
```

或者手动复制：

```
your-workspace/
└── .agents/skills/
    └── soft-delete/
        ├── SKILL.md
        └── scripts/
            └── trash.js
```

## 使用

```bash
# 伪删除
node scripts/trash.js delete <file1> [file2] ...

# 还原（按 ID）
node scripts/trash.js restore <id>

# 还原（按原始路径，仅还原最新删除的那份）
node scripts/trash.js restore --by-path <original_path>

# 查看回收站
node scripts/trash.js list
node scripts/trash.js list --date YYYY-MM-DD
```

## 工作原理

- 回收站：`~/.agent-trash/`（用户主目录下，跨项目共享）
- 按日期自动分组：`~/.agent-trash/YYYY-MM-DD/`
- 同名文件自动加时间戳后缀防冲突：`file_HHmmss.ext`
- 每次操作输出 JSON 报告，AI 可直接解析
- 还原时若目标路径已被占用，自动先伪删除现有文件再还原

## License

MIT
