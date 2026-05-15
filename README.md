# 小鹏 AI 客服 Web Demo — MVP

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

所有可调参数（模型、最大 token、客户信息、阶段、上传白名单、公司资料根目录、升级日志路径、资料检查工具的 `standardsDir` 和提取上限等）集中在 `lib/config.ts`。修改后重启 dev server 即生效。

## 文件上传

支持 `jpg / jpeg / png / webp / pdf / xlsx / xls / csv / txt / md`，单文件 ≤ 20 MB。所有上传按客户公司归档到 `./uploads/customers/<公司名>/`。

## 升级日志

触发升级（`notify_project_manager`）时，结构化记录写入 `./logs/escalations.log`。

## 资料标准检查

客户明确要求"检查 / 审核 / 分析"已上传资料时，小鹏会调用 `review_customer_files` 工具，依据 `./standards/customer-file-review/` 下的标准库（建站资料 9 个模块）生成中英双语报告。详见 `docs/FILE_REVIEW.md`。
