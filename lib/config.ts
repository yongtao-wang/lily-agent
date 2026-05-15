export const config = {
  model: 'claude-sonnet-4-6',
  maxTokens: 1800,
  temperature: 0.3,

  demoCustomer: {
    company: '东永盛',
    contact: '王总',
  },

  stages: [
    { id: 'collection', label: '资料收集' },
    { id: 'homepage',   label: '首页设计' },
    { id: 'seo',        label: 'SEO 与结构' },
    { id: 'pages',      label: '页面制作' },
    { id: 'testing',    label: '测试修改' },
    { id: 'launch',     label: '上线交付' },
  ] as const,

  upload: {
    allowedMimeTypes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'text/plain',
      'text/markdown',
    ],
    allowedExtensions: ['jpg', 'jpeg', 'png', 'webp', 'pdf', 'xlsx', 'xls', 'csv', 'txt', 'md'],
    maxSizeMB: 20,
    uploadDir: './uploads',
    companyRootDir: './uploads/customers',
  },

  fileReview: {
    standardsDir: './standards/customer-file-review',
    maxExtractCharsPerFile: 6000,
    maxFilesPerReview: 40,
  },

  escalation: {
    logPath: './logs/escalations.log',
    handoffMessage:
      '我已经把您的需求和当前情况完整同步给您的项目经理，他会在工作时间内主动联系您。在此期间您可以继续上传文件或补充说明，我会一并转交。',
  },

  placeholderDesignLink: 'https://example.com/preview',
};

export type StageId = (typeof config.stages)[number]['id'];

export function getStageLabel(stageId?: string): string | undefined {
  if (!stageId) return undefined;
  return config.stages.find((s) => s.id === stageId)?.label;
}
