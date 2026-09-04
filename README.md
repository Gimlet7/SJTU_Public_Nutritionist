# 公共营养师（二级）题库

纯静态刷题网页，可部署到 GitHub Pages。

## 目录

```text
.
├── index.html              # 网页入口
├── app.js                  # 页面逻辑和本地存储
├── styles.css              # 页面样式
├── config.js               # 访问密钥摘要配置
├── data/
│   ├── questions.json      # 学员端正式题库
│   ├── manifest.json       # 题库版本与统计
│   ├── source/             # 原始四库 JSON
│   └── review/             # 清洗全量、待复核题和报告
├── scripts/
│   └── build-project-bank.js
```

## 本地记忆

- IndexedDB 保存答题记录、错题、收藏和练习进度。
- 数据只保存在当前浏览器和设备。
- 清理浏览器站点数据、更换设备或使用隐私模式可能导致数据丢失。
