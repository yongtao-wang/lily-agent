# Lily AI 客服 Web Demo — MVP

单页面对话式 AI 客服，定位为出海营销服务公司的售后项目交付陪伴助手。

## 启动

```bash
# 1. 安装依赖
npm install

# 2. 配置 API Key
cp .env.local.example .env.local
# 编辑 .env.local 填入 ANTHROPIC_API_KEY

# 3. 确认知识库文件就位
ls knowledge/
# 应有：csr.md, 客服阶段话术库.xlsx

# 4. 启动
npm run dev

# 5. 访问
open http://localhost:3000
```

## 配置

所有可调参数（模型、客户信息、阶段、上传限制、升级日志路径等）集中在 `lib/config.ts`。修改后重启 dev server 即生效。

## 升级日志

触发升级时，结构化记录写入 `./logs/escalations.log`。
