import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

export default function AttendanceChart({ data = [] }) {
  // data: [{ date: '2026-04-20', total: 12 }, …]
  const formatted = [...data]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ ...d, label: d.date.slice(5) })) // show MM-DD

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <h3 className="text-sm font-semibold text-gray-600 mb-4">Daily Attendance (last 7 days)</h3>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={formatted} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
          <Tooltip
            contentStyle={{ borderRadius: '8px', fontSize: '12px' }}
            labelFormatter={(l) => `Date: ${l}`}
          />
          <Bar dataKey="total" fill="#3b82f6" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
