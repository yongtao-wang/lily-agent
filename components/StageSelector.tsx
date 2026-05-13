'use client';

export default function StageSelector({
  stages,
  onSelect,
  disabled,
}: {
  stages: Array<{ id: string; label: string }>;
  onSelect: (id: string | null, label: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="my-3 ml-10">
      <div className="text-xs text-gray-500 mb-2">请选择当前阶段，或点击"跳过"自行描述：</div>
      <div className="flex flex-wrap gap-2">
        {stages.map((s) => (
          <button
            key={s.id}
            disabled={disabled}
            onClick={() => onSelect(s.id, s.label)}
            className="px-3 py-1.5 text-sm rounded-full bg-white border border-lily-500 text-lily-700 hover:bg-lily-50 transition disabled:opacity-50"
          >
            {s.label}
          </button>
        ))}
        <button
          disabled={disabled}
          onClick={() => onSelect(null, '跳过')}
          className="px-3 py-1.5 text-sm rounded-full bg-white border border-gray-300 text-gray-600 hover:bg-gray-50 transition disabled:opacity-50"
        >
          跳过
        </button>
      </div>
    </div>
  );
}
