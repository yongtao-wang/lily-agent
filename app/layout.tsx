import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '小鹏 · AI 增长顾问',
  description: '小鹏 AI 客服 Web Demo',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
