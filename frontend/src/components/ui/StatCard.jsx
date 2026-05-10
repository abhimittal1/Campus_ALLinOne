export default function StatCard({ title, value, subtitle, colorClass = 'bg-primary-500' }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-lg ${colorClass} flex items-center justify-center text-white text-xl font-bold shrink-0`}>
        {typeof value === 'string' && value.length > 3 ? value[0] : value}
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-800">{value}</p>
        <p className="text-sm text-gray-500">{title}</p>
        {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  )
}
