export default function DemoBanner({
  company,
  contact,
}: {
  company: string;
  contact: string;
}) {
  return (
    <div className="bg-amber-100 border-b border-amber-200 px-4 py-2 text-sm text-amber-900 flex items-center gap-3">
      <span className="font-semibold">🧪 DEMO MODE</span>
      <span className="opacity-70">·</span>
      <span>客户：<span className="font-medium">{company}</span></span>
      <span className="opacity-70">·</span>
      <span>对接人：<span className="font-medium">{contact}</span></span>
    </div>
  );
}
