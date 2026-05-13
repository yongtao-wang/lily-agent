import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';

export type Script = {
  stageId: string;
  stageName: string;
  category: string;
  content: string;
};

export type QAEntry = {
  stageId: string;
  stageName: string;
  scenario: string;
  trigger: string;
  question: string;
  answer: string;
  followUp: string;
};

export interface KnowledgeBase {
  persona: string;
  scripts: Script[];
  qa: QAEntry[];
}

const STAGE_ALIASES: Record<string, string> = {
  '1-资料收集': 'collection', '资料收集': 'collection',
  '2-首页设计': 'homepage',   '首页设计': 'homepage',
  '3-SEO与结构': 'seo',       'SEO与结构': 'seo', 'SEO': 'seo', 'SEO 与结构': 'seo',
  '4-页面制作': 'pages',      '页面制作': 'pages',
  '5-测试修改': 'testing',    '测试修改': 'testing',
  '6-上线交付': 'launch',     '上线交付': 'launch',
};

export function normalizeStage(input: unknown): { id: string; name: string } | undefined {
  if (typeof input !== 'string') return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  const id = STAGE_ALIASES[trimmed];
  if (!id) return undefined;
  const name = trimmed.replace(/^\d+-/, '');
  return { id, name };
}

let cache: KnowledgeBase | undefined;

export function loadKnowledge(): KnowledgeBase {
  if (cache) return cache;

  const root = process.cwd();
  const personaPath = path.join(root, 'knowledge', 'csr.md');
  const xlsxPath = path.join(root, 'knowledge', '客服阶段话术库.xlsx');

  const persona = fs.readFileSync(personaPath, 'utf8');
  const wb = XLSX.readFile(xlsxPath);

  const scripts: Script[] = [];
  const scriptsSheet = wb.Sheets['话术库表'];
  if (scriptsSheet) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(scriptsSheet, { defval: '' });
    for (const row of rows) {
      const stage = normalizeStage(row['项目阶段']);
      const category = String(row['需发类目'] ?? '').trim();
      const content = String(row['开场话术'] ?? '').trim();
      if (!stage || !content) continue;
      scripts.push({
        stageId: stage.id,
        stageName: stage.name,
        category,
        content,
      });
    }
  }

  const qa: QAEntry[] = [];
  const qaSheet = wb.Sheets['问答表'];
  if (qaSheet) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(qaSheet, { defval: '' });
    for (const row of rows) {
      const stage = normalizeStage(row['项目阶段']);
      const question = String(row['客户原话'] ?? '').trim();
      const answer = String(row['标准回复'] ?? '').trim();
      if (!stage || !question || !answer) continue;
      qa.push({
        stageId: stage.id,
        stageName: stage.name,
        scenario: String(row['场景分类'] ?? '').trim(),
        trigger: String(row['触发情况'] ?? '').trim(),
        question,
        answer,
        followUp: String(row['后续动作'] ?? '').trim(),
      });
    }
  }

  cache = { persona, scripts, qa };
  return cache;
}
